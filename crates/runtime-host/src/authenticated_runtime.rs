use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use vrcx_0_application::{
    AuthenticatedRuntimePhase, AuthenticatedRuntimePhaseSnapshot, AuthenticatedRuntimeSession,
    AuthenticatedRuntimeStepSnapshot, AuthenticatedRuntimeStepStatus,
};
use vrcx_0_application_core::{
    HostSessionRuntime, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus,
    RuntimeVrchatAuthFailurePayload, TaskStopToken, TaskSupervisor, WebClient,
};
use vrcx_0_application_realtime::{
    build_favorites_baseline, build_friend_roster_baseline, RealtimeHostRuntime,
    RealtimeStopRequest, SocialBaselineDeps, SocialFavoritesBaselineInput,
    SocialFavoritesBaselineOutput, SocialFriendRosterBaselineInput,
    SocialFriendRosterBaselineOutput,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result, RuntimeHostSnapshotCallback};

const RETRY_DELAYS_SECONDS: [u64; 4] = [5, 15, 30, 60];
const RETRY_SLEEP_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy)]
enum RuntimeStep {
    Friends,
    Favorites,
    Realtime,
}

#[derive(Clone)]
pub struct AuthenticatedRuntimeOrchestrator {
    snapshot: Arc<Mutex<AuthenticatedRuntimePhaseSnapshot>>,
    generation: Arc<AtomicU64>,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    auth_scope: RuntimeAuthScope,
    session: HostSessionRuntime,
    realtime_runtime: Arc<RealtimeHostRuntime>,
    favorites_sink: Option<RuntimeHostSnapshotCallback>,
}

impl AuthenticatedRuntimeOrchestrator {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        auth_scope: RuntimeAuthScope,
        session: HostSessionRuntime,
        realtime_runtime: Arc<RealtimeHostRuntime>,
        favorites_sink: Option<RuntimeHostSnapshotCallback>,
    ) -> Self {
        Self {
            snapshot: Arc::new(Mutex::new(AuthenticatedRuntimePhaseSnapshot::default())),
            generation: Arc::new(AtomicU64::new(0)),
            db,
            web,
            event_bus,
            tasks,
            auth_scope,
            session,
            realtime_runtime,
            favorites_sink,
        }
    }

    pub fn snapshot(&self) -> AuthenticatedRuntimePhaseSnapshot {
        let mut snapshot = self.lock_snapshot().clone();
        let Some(current_friends) = self.realtime_runtime.friend_snapshot() else {
            return snapshot;
        };
        if current_friends.current_user_id != snapshot.user_id
            || current_friends.endpoint != snapshot.endpoint
            || current_friends.websocket != snapshot.websocket
        {
            return snapshot;
        }
        let Some(friend_baseline) = snapshot.friend_baseline.as_mut() else {
            return snapshot;
        };
        let previous = friend_baseline.snapshot.as_ref().map(RawJson::as_value);
        match current_friend_baseline_snapshot(
            &snapshot.user_id,
            &current_friends.friends_by_id,
            previous,
        ) {
            Ok(current) => {
                friend_baseline.count = current_friends.friends_by_id.len();
                friend_baseline.snapshot = Some(RawJson::from(current));
                friend_baseline.friend_log_changed = false;
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to build current friend phase snapshot");
            }
        }
        snapshot
    }

    pub fn update_favorites_baseline(&self, output: SocialFavoritesBaselineOutput) {
        if output.stale || output.snapshot.is_none() {
            return;
        }
        let mut snapshot = self.lock_snapshot();
        if snapshot.user_id != output.user_id
            || !matches!(
                snapshot.phase,
                AuthenticatedRuntimePhase::Starting | AuthenticatedRuntimePhase::Ready
            )
        {
            return;
        }
        snapshot.favorites_baseline = Some(output);
        snapshot.updated_at = now_iso();
    }

    pub fn apply_favorites_snapshot(&self, snapshot: &Value) {
        if let Some(favorites_sink) = &self.favorites_sink {
            favorites_sink(snapshot);
        }
    }

    pub fn start(
        &self,
        session: AuthenticatedRuntimeSession,
    ) -> Result<AuthenticatedRuntimePhaseSnapshot> {
        if session.user_id.trim().is_empty() {
            return Err(Error::Custom(
                "Authenticated runtime requires an authenticated user id.".into(),
            ));
        }

        let scope = self.auth_scope.set(&session.user_id, &session.endpoint);
        let current = self.snapshot();
        if matches!(
            current.phase,
            AuthenticatedRuntimePhase::Starting | AuthenticatedRuntimePhase::Ready
        ) && snapshot_matches_session(&current, &session, scope.generation)
        {
            return Ok(current);
        }

        self.realtime_runtime.stop(RealtimeStopRequest::default());
        let run_id = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let snapshot = AuthenticatedRuntimePhaseSnapshot {
            run_id,
            auth_scope_generation: scope.generation,
            user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            phase: AuthenticatedRuntimePhase::Starting,
            updated_at: now_iso(),
            ..Default::default()
        };
        *self.lock_snapshot() = snapshot.clone();
        self.emit(snapshot.clone());

        let runtime = self.clone();
        self.tasks.spawn_cancellable(move |stop_token| async move {
            runtime.run(session, scope, run_id, stop_token).await;
        });
        Ok(snapshot)
    }

    pub fn stop(&self) -> AuthenticatedRuntimePhaseSnapshot {
        let previous = self.snapshot();
        if matches!(
            previous.phase,
            AuthenticatedRuntimePhase::Idle | AuthenticatedRuntimePhase::Stopped
        ) {
            return previous;
        }
        let run_id = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.realtime_runtime.stop(RealtimeStopRequest::default());
        let snapshot = AuthenticatedRuntimePhaseSnapshot {
            run_id,
            auth_scope_generation: previous.auth_scope_generation,
            user_id: previous.user_id,
            endpoint: previous.endpoint,
            websocket: previous.websocket,
            phase: AuthenticatedRuntimePhase::Stopped,
            updated_at: now_iso(),
            ..Default::default()
        };
        *self.lock_snapshot() = snapshot.clone();
        self.emit(snapshot.clone());
        snapshot
    }

    async fn run(
        &self,
        session: AuthenticatedRuntimeSession,
        scope: RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: TaskStopToken,
    ) {
        let Some(friends_by_id) = self
            .run_friend_baseline(&session, &scope, run_id, &stop_token)
            .await
        else {
            return;
        };
        if !self.is_active(run_id, &scope, &stop_token) {
            return;
        }

        let favorites =
            self.run_favorites_baseline(&session, &scope, run_id, &stop_token, &friends_by_id);
        let realtime_friends = friends_by_id.clone();
        let realtime =
            self.run_realtime_transport(&session, &scope, run_id, &stop_token, realtime_friends);
        let (favorites_ready, realtime_ready) = tokio::join!(favorites, realtime);
        if favorites_ready && realtime_ready && self.is_active(run_id, &scope, &stop_token) {
            self.update_snapshot(run_id, |snapshot| {
                snapshot.phase = AuthenticatedRuntimePhase::Ready;
            });
        }
    }

    async fn run_friend_baseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
    ) -> Option<HashMap<String, FriendRecord>> {
        let mut attempt = 1;
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return None;
            }
            self.set_step_running(run_id, RuntimeStep::Friends, attempt);
            let result = build_friend_roster_baseline(
                self.social_baseline_deps(),
                SocialFriendRosterBaselineInput {
                    user_id: session.user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    websocket: session.websocket.clone(),
                    current_user_snapshot: RawJson::from(session.current_user.clone()),
                    is_first_load: true,
                },
            )
            .await;
            if !self.is_active(run_id, scope, stop_token) {
                return None;
            }

            match result.map_err(Error::from).and_then(decode_friend_baseline) {
                Ok((mut output, friends_by_id)) => {
                    if output.detail.trim().is_empty() {
                        output.detail = format!(
                            "Friend roster baseline loaded for {}.",
                            session.display_name
                        );
                    }
                    self.update_snapshot(run_id, |snapshot| {
                        snapshot.friends =
                            ready_step(attempt, format!("{} friends loaded.", output.count));
                        snapshot.friend_baseline = Some(output.clone());
                    });
                    return Some(friends_by_id);
                }
                Err(error) => {
                    self.emit_auth_failure_if_needed(
                        scope,
                        "runtime/social-baseline/friends",
                        &error,
                    );
                    let delay = retry_delay_seconds(attempt);
                    self.set_step_retry(
                        run_id,
                        RuntimeStep::Friends,
                        attempt,
                        delay,
                        error.to_string(),
                    );
                    if !self.wait_for_retry(delay, run_id, scope, stop_token).await {
                        return None;
                    }
                    attempt = attempt.saturating_add(1);
                }
            }
        }
    }

    async fn run_favorites_baseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
        friends_by_id: &HashMap<String, FriendRecord>,
    ) -> bool {
        let friend_roster_by_id =
            RawJson::from(serde_json::to_value(friends_by_id).unwrap_or_default());
        let mut attempt = 1;
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return false;
            }
            self.set_step_running(run_id, RuntimeStep::Favorites, attempt);
            let result = build_favorites_baseline(
                self.social_baseline_deps(),
                SocialFavoritesBaselineInput {
                    user_id: session.user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    current_user_snapshot: RawJson::from(session.current_user.clone()),
                    friend_roster_by_id: friend_roster_by_id.clone(),
                },
            )
            .await;
            if !self.is_active(run_id, scope, stop_token) {
                return false;
            }

            match result
                .map_err(Error::from)
                .and_then(require_favorites_baseline)
            {
                Ok(output) => {
                    if let Some(snapshot) = output.snapshot.as_ref().map(RawJson::as_value) {
                        self.apply_favorites_snapshot(snapshot);
                    }
                    self.update_snapshot(run_id, |snapshot| {
                        snapshot.favorites =
                            ready_step(attempt, format!("{} favorites loaded.", output.count));
                        snapshot.favorites_baseline = Some(output);
                    });
                    return true;
                }
                Err(error) => {
                    self.emit_auth_failure_if_needed(
                        scope,
                        "runtime/social-baseline/favorites",
                        &error,
                    );
                    let delay = retry_delay_seconds(attempt);
                    self.set_step_retry(
                        run_id,
                        RuntimeStep::Favorites,
                        attempt,
                        delay,
                        error.to_string(),
                    );
                    if !self.wait_for_retry(delay, run_id, scope, stop_token).await {
                        return false;
                    }
                    attempt = attempt.saturating_add(1);
                }
            }
        }
    }

    async fn run_realtime_transport(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> bool {
        let mut attempt = 1;
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return false;
            }
            self.set_step_running(run_id, RuntimeStep::Realtime, attempt);
            match self.realtime_runtime.start(
                session.user_id.clone(),
                session.endpoint.clone(),
                session.websocket.clone(),
                run_id,
                session.current_user.clone(),
                friends_by_id.clone(),
            ) {
                Ok(result) => {
                    if !self.is_active(run_id, scope, stop_token) {
                        self.realtime_runtime.stop(RealtimeStopRequest {
                            user_id: Some(session.user_id.clone()),
                            endpoint: Some(session.endpoint.clone()),
                            websocket: Some(session.websocket.clone()),
                            client_run_id: Some(run_id),
                            generation: Some(result.generation),
                        });
                        return false;
                    }
                    self.update_snapshot(run_id, |snapshot| {
                        snapshot.realtime =
                            ready_step(attempt, "Realtime transport started.".into());
                        snapshot.realtime_transport = Some(result);
                    });
                    return true;
                }
                Err(error) => {
                    let delay = retry_delay_seconds(attempt);
                    self.set_step_retry(
                        run_id,
                        RuntimeStep::Realtime,
                        attempt,
                        delay,
                        error.to_string(),
                    );
                    if !self.wait_for_retry(delay, run_id, scope, stop_token).await {
                        return false;
                    }
                    attempt = attempt.saturating_add(1);
                }
            }
        }
    }

    fn social_baseline_deps(&self) -> SocialBaselineDeps {
        SocialBaselineDeps {
            db: Arc::clone(&self.db),
            web: Arc::clone(&self.web),
            auth_scope: self.auth_scope.clone(),
            session: self.session.clone(),
        }
    }

    fn emit_auth_failure_if_needed(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        path: &str,
        error: &Error,
    ) {
        let reason = error.to_string();
        if !is_missing_credentials_error(&reason)
            || !auth_scope_matches(&self.auth_scope.snapshot(), scope)
        {
            return;
        }
        self.event_bus
            .emit_runtime_vrchat_auth_failure(RuntimeVrchatAuthFailurePayload {
                owner_user_id: scope.current_user_id.clone(),
                endpoint: scope.endpoint.clone(),
                path: path.to_string(),
                reason,
                status_code: 401,
                auth_scope_generation: scope.generation,
            });
    }

    fn is_active(
        &self,
        run_id: u64,
        scope: &RuntimeAuthScopeSnapshot,
        stop_token: &TaskStopToken,
    ) -> bool {
        !stop_token.is_stop_requested()
            && self.generation.load(Ordering::Acquire) == run_id
            && auth_scope_matches(&self.auth_scope.snapshot(), scope)
    }

    async fn wait_for_retry(
        &self,
        delay_seconds: u64,
        run_id: u64,
        scope: &RuntimeAuthScopeSnapshot,
        stop_token: &TaskStopToken,
    ) -> bool {
        let mut remaining = Duration::from_secs(delay_seconds);
        while !remaining.is_zero() {
            if !self.is_active(run_id, scope, stop_token) {
                return false;
            }
            let sleep_for = remaining.min(RETRY_SLEEP_POLL_INTERVAL);
            tokio::time::sleep(sleep_for).await;
            remaining = remaining.saturating_sub(sleep_for);
        }
        self.is_active(run_id, scope, stop_token)
    }

    fn set_step_running(&self, run_id: u64, step: RuntimeStep, attempt: u32) {
        self.update_snapshot(run_id, |snapshot| {
            *step_snapshot_mut(snapshot, step) = AuthenticatedRuntimeStepSnapshot {
                status: AuthenticatedRuntimeStepStatus::Running,
                attempt,
                detail: format!("{} is starting.", step_name(step)),
                ..Default::default()
            };
        });
    }

    fn set_step_retry(
        &self,
        run_id: u64,
        step: RuntimeStep,
        attempt: u32,
        delay_seconds: u64,
        error: String,
    ) {
        self.update_snapshot(run_id, |snapshot| {
            *step_snapshot_mut(snapshot, step) = AuthenticatedRuntimeStepSnapshot {
                status: AuthenticatedRuntimeStepStatus::RetryWaiting,
                attempt,
                retry_delay_seconds: Some(delay_seconds),
                detail: format!("{} retry is waiting.", step_name(step)),
                last_error: Some(error),
            };
        });
    }

    fn update_snapshot(
        &self,
        run_id: u64,
        update: impl FnOnce(&mut AuthenticatedRuntimePhaseSnapshot),
    ) {
        let snapshot = {
            let mut snapshot = self.lock_snapshot();
            if snapshot.run_id != run_id {
                return;
            }
            update(&mut snapshot);
            snapshot.updated_at = now_iso();
            snapshot.clone()
        };
        self.emit(snapshot);
    }

    fn emit(&self, snapshot: AuthenticatedRuntimePhaseSnapshot) {
        self.event_bus.emit(snapshot);
    }

    fn lock_snapshot(&self) -> MutexGuard<'_, AuthenticatedRuntimePhaseSnapshot> {
        self.snapshot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn step_snapshot_mut(
    snapshot: &mut AuthenticatedRuntimePhaseSnapshot,
    step: RuntimeStep,
) -> &mut AuthenticatedRuntimeStepSnapshot {
    match step {
        RuntimeStep::Friends => &mut snapshot.friends,
        RuntimeStep::Favorites => &mut snapshot.favorites,
        RuntimeStep::Realtime => &mut snapshot.realtime,
    }
}

fn step_name(step: RuntimeStep) -> &'static str {
    match step {
        RuntimeStep::Friends => "Friend baseline",
        RuntimeStep::Favorites => "Favorites baseline",
        RuntimeStep::Realtime => "Realtime transport",
    }
}

fn ready_step(attempt: u32, detail: String) -> AuthenticatedRuntimeStepSnapshot {
    AuthenticatedRuntimeStepSnapshot {
        status: AuthenticatedRuntimeStepStatus::Ready,
        attempt,
        detail,
        ..Default::default()
    }
}

fn decode_friend_baseline(
    output: SocialFriendRosterBaselineOutput,
) -> Result<(
    SocialFriendRosterBaselineOutput,
    HashMap<String, FriendRecord>,
)> {
    if output.stale {
        return Err(Error::Custom(if output.detail.trim().is_empty() {
            "Friend roster baseline was stale.".into()
        } else {
            output.detail.clone()
        }));
    }
    let friends = output
        .snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.as_value().get("friendsById"))
        .cloned()
        .ok_or_else(|| Error::Custom("Friend roster baseline has no snapshot.".into()))?;
    let friends_by_id = serde_json::from_value(friends)?;
    Ok((output, friends_by_id))
}

fn require_favorites_baseline(
    output: SocialFavoritesBaselineOutput,
) -> Result<SocialFavoritesBaselineOutput> {
    if output.stale || output.snapshot.is_none() {
        return Err(Error::Custom("Favorites baseline was stale.".into()));
    }
    Ok(output)
}

fn retry_delay_seconds(attempt: u32) -> u64 {
    RETRY_DELAYS_SECONDS[(attempt.saturating_sub(1) as usize).min(RETRY_DELAYS_SECONDS.len() - 1)]
}

fn is_missing_credentials_error(reason: &str) -> bool {
    reason.to_ascii_lowercase().contains("missing credentials")
}

fn snapshot_matches_session(
    snapshot: &AuthenticatedRuntimePhaseSnapshot,
    session: &AuthenticatedRuntimeSession,
    auth_scope_generation: u64,
) -> bool {
    snapshot.auth_scope_generation == auth_scope_generation
        && snapshot.user_id == session.user_id
        && snapshot.endpoint == session.endpoint
        && snapshot.websocket == session.websocket
}

fn auth_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> bool {
    current.active
        && current.generation == expected.generation
        && current.current_user_id == expected.current_user_id
        && current.endpoint == expected.endpoint
}

fn current_friend_baseline_snapshot(
    user_id: &str,
    friends_by_id: &HashMap<String, FriendRecord>,
    previous: Option<&Value>,
) -> Result<Value> {
    let mut ordered_friend_ids = previous
        .and_then(|snapshot| snapshot.get("orderedFriendIds"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|friend_id| friends_by_id.contains_key(*friend_id))
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut seen = ordered_friend_ids.iter().cloned().collect::<HashSet<_>>();
    let mut added = friends_by_id
        .keys()
        .filter(|friend_id| seen.insert((*friend_id).clone()))
        .cloned()
        .collect::<Vec<_>>();
    added.sort();
    ordered_friend_ids.extend(added);

    let bucket_ids = |bucket: &str| {
        ordered_friend_ids
            .iter()
            .filter(|friend_id| {
                friends_by_id
                    .get(*friend_id)
                    .is_some_and(|friend| friend_state_bucket(friend) == bucket)
            })
            .cloned()
            .collect::<Vec<_>>()
    };
    let online_ids = bucket_ids("online");
    let active_ids = bucket_ids("active");
    let offline_ids = bucket_ids("offline");
    let ordered_friend_ids = online_ids
        .iter()
        .chain(&active_ids)
        .chain(&offline_ids)
        .cloned()
        .collect::<Vec<_>>();

    Ok(json!({
        "currentUserId": user_id,
        "friendsById": friends_by_id,
        "orderedFriendIds": ordered_friend_ids,
        "onlineIds": online_ids,
        "activeIds": active_ids,
        "offlineIds": offline_ids,
        "detail": "",
    }))
}

fn friend_state_bucket(friend: &FriendRecord) -> &str {
    let state = if friend.state_bucket.is_empty() {
        friend.state.as_str()
    } else {
        friend.state_bucket.as_str()
    };
    match state {
        "online" => "online",
        "active" => "active",
        _ => "offline",
    }
}

pub fn favorite_group_membership_from_snapshot(snapshot: &Value) -> HashMap<String, Vec<String>> {
    let mut groups = HashMap::new();
    append_favorite_group_membership(
        &mut groups,
        snapshot.get("groupedFavoriteFriendIdsByGroupKey"),
        "",
    );
    append_favorite_group_membership(&mut groups, snapshot.get("localFriendFavorites"), "local:");
    groups
}

fn append_favorite_group_membership(
    groups: &mut HashMap<String, Vec<String>>,
    value: Option<&Value>,
    key_prefix: &str,
) {
    let Some(object) = value.and_then(Value::as_object) else {
        return;
    };
    for (group_key, user_ids) in object {
        let user_ids = user_ids
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !user_ids.is_empty() {
            groups.insert(format!("{key_prefix}{group_key}"), user_ids);
        }
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn retry_schedule_caps_at_sixty_seconds() {
        assert_eq!(retry_delay_seconds(1), 5);
        assert_eq!(retry_delay_seconds(2), 15);
        assert_eq!(retry_delay_seconds(3), 30);
        assert_eq!(retry_delay_seconds(4), 60);
        assert_eq!(retry_delay_seconds(20), 60);
    }

    #[test]
    fn recognizes_missing_credentials_auth_failures() {
        assert!(is_missing_credentials_error("Missing Credentials (401)"));
        assert!(!is_missing_credentials_error("request timed out"));
    }

    #[test]
    fn session_match_includes_scope_and_transport_identity() {
        let session = AuthenticatedRuntimeSession::from_user(
            json!({"id": "usr_one", "displayName": "One"}),
            "https://api.example.test/api/1".into(),
            "wss://pipeline.example.test".into(),
        );
        let snapshot = AuthenticatedRuntimePhaseSnapshot {
            auth_scope_generation: 4,
            user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            ..Default::default()
        };

        assert!(snapshot_matches_session(&snapshot, &session, 4));
        assert!(!snapshot_matches_session(&snapshot, &session, 5));

        let mut other_transport = session.clone();
        other_transport.websocket = "wss://other.example.test".into();
        assert!(!snapshot_matches_session(&snapshot, &other_transport, 4));
    }

    #[test]
    fn current_friend_snapshot_preserves_order_and_appends_new_friends() {
        let friends = HashMap::from([
            (
                "usr_existing".into(),
                FriendRecord {
                    id: "usr_existing".into(),
                    state_bucket: "active".into(),
                    ..Default::default()
                },
            ),
            (
                "usr_new".into(),
                FriendRecord {
                    id: "usr_new".into(),
                    state_bucket: "online".into(),
                    ..Default::default()
                },
            ),
        ]);
        let snapshot = current_friend_baseline_snapshot(
            "usr_self",
            &friends,
            Some(&json!({
                "orderedFriendIds": ["usr_removed", "usr_existing"]
            })),
        )
        .unwrap();

        assert_eq!(
            snapshot["orderedFriendIds"],
            json!(["usr_new", "usr_existing"])
        );
        assert_eq!(snapshot["onlineIds"], json!(["usr_new"]));
        assert_eq!(snapshot["activeIds"], json!(["usr_existing"]));
        assert_eq!(snapshot["offlineIds"], json!([]));
    }
}
