use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

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
    build_favorites_baseline_from_friend_records, build_synced_friend_roster_baseline,
    FavoriteBaselineSnapshot, RealtimeHostRuntime, RealtimeStopRequest,
    RealtimeTransportLifecycleEvent, RealtimeTransportStartResult, RealtimeTransportTermination,
    SocialBaselineDeps, SocialFavoritesBaselineOutput, SocialFavoritesBaselineRequest,
    SocialFriendRosterBaselineInput, SocialFriendRosterBaselineOutput,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::RawJson;
use vrcx_0_core::time::now_iso;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::auth::current_user_get_input;
use vrcx_0_vrchat_client::http_api::ApiScope;

use crate::{Error, Result, RuntimeHostFavoritesCallback};

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
    favorites_sink: Option<RuntimeHostFavoritesCallback>,
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
        favorites_sink: Option<RuntimeHostFavoritesCallback>,
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

    pub fn apply_favorites_snapshot(&self, snapshot: &FavoriteBaselineSnapshot) {
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
        let same_session = snapshot_matches_session(&current, &session, scope.generation);
        let already_active = match current.phase {
            AuthenticatedRuntimePhase::Starting => same_session,
            AuthenticatedRuntimePhase::Ready => {
                same_session
                    && current
                        .realtime_transport
                        .as_ref()
                        .is_some_and(|transport| {
                            self.realtime_runtime.transport_is_active(transport)
                        })
            }
            _ => false,
        };
        if already_active {
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
        let realtime = self.run_realtime_with_rebaseline(
            &session,
            &scope,
            run_id,
            &stop_token,
            realtime_friends,
        );
        tokio::join!(favorites, realtime);
    }

    async fn run_realtime_with_rebaseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
        mut friends_by_id: HashMap<String, FriendRecord>,
    ) {
        let mut attempt: u32 = 1;
        let mut roster_stale = false;
        loop {
            let termination = self
                .run_realtime_transport(
                    session,
                    scope,
                    run_id,
                    stop_token,
                    attempt,
                    friends_by_id.clone(),
                )
                .await;
            let (reason, probe_auth) = match termination {
                Some(RealtimeTransportTermination::UnexpectedExit {
                    reason,
                    connected_secs,
                }) => {
                    if connected_secs.is_some() {
                        attempt = 1;
                        roster_stale = true;
                    }
                    self.trail(
                        "retryScheduled",
                        json!({
                            "runId": run_id,
                            "attempt": attempt,
                            "connectedSecs": connected_secs,
                            "reason": reason,
                        }),
                    );
                    (reason, false)
                }
                Some(RealtimeTransportTermination::AuthExpired {
                    reason,
                    status_code,
                }) => {
                    self.trail(
                        "retryScheduled",
                        json!({
                            "runId": run_id,
                            "attempt": attempt,
                            "authCode": status_code,
                            "reason": reason,
                        }),
                    );
                    (reason, true)
                }
                None => {
                    self.trail(
                        "supervisionEnded",
                        json!({ "runId": run_id, "stage": "inactive" }),
                    );
                    return;
                }
                Some(RealtimeTransportTermination::Stopped) => {
                    self.trail(
                        "supervisionEnded",
                        json!({ "runId": run_id, "stage": "stopped" }),
                    );
                    return;
                }
            };

            let delay = retry_delay_seconds(attempt);
            self.set_step_retry(run_id, RuntimeStep::Realtime, attempt, delay, reason);
            if !self.wait_for_retry(delay, run_id, scope, stop_token).await {
                self.trail(
                    "supervisionEnded",
                    json!({ "runId": run_id, "stage": "retryWait" }),
                );
                return;
            }
            if probe_auth {
                self.probe_auth_session(session, scope, run_id, attempt)
                    .await;
            }
            if roster_stale {
                match self
                    .try_friend_baseline(session, scope, run_id, stop_token, attempt)
                    .await
                {
                    Ok(Some(fresh)) => {
                        self.trail(
                            "rebaselined",
                            json!({
                                "runId": run_id,
                                "attempt": attempt,
                                "friends": fresh.len(),
                            }),
                        );
                        friends_by_id = fresh;
                        roster_stale = false;
                    }
                    Ok(None) => {
                        self.trail(
                            "supervisionEnded",
                            json!({ "runId": run_id, "stage": "rebaseline" }),
                        );
                        return;
                    }
                    Err(error) => self.trail(
                        "rebaselineSkipped",
                        json!({
                            "runId": run_id,
                            "attempt": attempt,
                            "reason": error.to_string(),
                        }),
                    ),
                }
            }
            attempt = attempt.saturating_add(1);
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
            match self
                .try_friend_baseline(session, scope, run_id, stop_token, attempt)
                .await
            {
                Ok(Some(friends_by_id)) => return Some(friends_by_id),
                Ok(None) => return None,
                Err(error) => {
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

    async fn try_friend_baseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
        attempt: u32,
    ) -> Result<Option<HashMap<String, FriendRecord>>> {
        if !self.is_active(run_id, scope, stop_token) {
            return Ok(None);
        }
        self.set_step_running(run_id, RuntimeStep::Friends, attempt);
        let result = build_synced_friend_roster_baseline(
            self.social_baseline_deps(),
            &self.realtime_runtime,
            SocialFriendRosterBaselineInput {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                websocket: session.websocket.clone(),
                current_user_snapshot: RawJson::from(session.current_user.clone()),
                is_first_load: true,
            },
        )
        .await
        .map_err(Error::from)
        .and_then(|baseline| {
            let output = baseline.output;
            match baseline.friends_by_id {
                Some(friends_by_id) => Ok((output, friends_by_id)),
                None => Err(Error::Custom(if output.detail.trim().is_empty() {
                    "Friend roster baseline was stale.".into()
                } else {
                    output.detail
                })),
            }
        });
        if !self.is_active(run_id, scope, stop_token) {
            return Ok(None);
        }

        match result {
            Ok((mut output, friends_by_id)) => {
                if output.detail.trim().is_empty() {
                    output.detail = format!(
                        "Friend roster baseline loaded for {}.",
                        session.display_name
                    );
                }
                self.update_snapshot(run_id, |snapshot| {
                    commit_friend_baseline(snapshot, attempt, output.clone());
                });
                Ok(Some(friends_by_id))
            }
            Err(error) => {
                self.emit_auth_failure_if_needed(scope, "runtime/social-baseline/friends", &error);
                Err(error)
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
    ) {
        let mut attempt = 1;
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return;
            }
            self.set_step_running(run_id, RuntimeStep::Favorites, attempt);
            let result = build_favorites_baseline_from_friend_records(
                self.social_baseline_deps(),
                SocialFavoritesBaselineRequest {
                    user_id: session.user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    current_user_snapshot: RawJson::from(session.current_user.clone()),
                },
                friends_by_id,
            )
            .await;
            if !self.is_active(run_id, scope, stop_token) {
                return;
            }

            match result
                .map_err(Error::from)
                .and_then(require_favorites_baseline)
            {
                Ok(output) => {
                    if let Some(snapshot) = output.snapshot.as_ref() {
                        self.apply_favorites_snapshot(snapshot);
                    }
                    self.update_snapshot(run_id, |snapshot| {
                        snapshot.favorites =
                            ready_step(attempt, format!("{} favorites loaded.", output.count));
                        snapshot.favorites_baseline = Some(output);
                    });
                    self.mark_ready_if_complete(run_id);
                    return;
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
                        return;
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
        attempt: u32,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Option<RealtimeTransportTermination> {
        if !self.is_active(run_id, scope, stop_token) {
            return None;
        }
        self.set_step_running(run_id, RuntimeStep::Realtime, attempt);
        let mut lifecycle = self.realtime_runtime.subscribe_transport_lifecycle();
        let result = match self.realtime_runtime.start(
            session.user_id.clone(),
            session.endpoint.clone(),
            session.websocket.clone(),
            run_id,
            session.current_user.clone(),
            friends_by_id,
        ) {
            Ok(result) => result,
            Err(error) => {
                return Some(RealtimeTransportTermination::UnexpectedExit {
                    reason: error.to_string(),
                    connected_secs: None,
                });
            }
        };
        if !self.is_active(run_id, scope, stop_token) {
            self.realtime_runtime.stop(RealtimeStopRequest {
                user_id: Some(session.user_id.clone()),
                endpoint: Some(session.endpoint.clone()),
                websocket: Some(session.websocket.clone()),
                client_run_id: Some(run_id),
                generation: Some(result.generation),
            });
            return None;
        }
        self.update_snapshot(run_id, |snapshot| {
            snapshot.realtime = AuthenticatedRuntimeStepSnapshot {
                status: AuthenticatedRuntimeStepStatus::Running,
                attempt,
                detail: "Realtime transport is waiting for a connection.".into(),
                ..Default::default()
            };
            snapshot.realtime_transport = Some(result.clone());
        });
        self.monitor_realtime_transport(run_id, scope, stop_token, attempt, result, &mut lifecycle)
            .await
    }

    async fn monitor_realtime_transport(
        &self,
        run_id: u64,
        scope: &RuntimeAuthScopeSnapshot,
        stop_token: &TaskStopToken,
        attempt: u32,
        transport: RealtimeTransportStartResult,
        lifecycle: &mut tokio::sync::broadcast::Receiver<RealtimeTransportLifecycleEvent>,
    ) -> Option<RealtimeTransportTermination> {
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return None;
            }
            tokio::select! {
                event = lifecycle.recv() => {
                    match event {
                        Ok(RealtimeTransportLifecycleEvent::Connected(connected))
                            if connected == transport =>
                        {
                            self.update_snapshot(run_id, |snapshot| {
                                apply_realtime_connected(snapshot, attempt, &transport);
                            });
                            self.mark_ready_if_complete(run_id);
                        }
                        Ok(RealtimeTransportLifecycleEvent::Finished {
                            transport: finished,
                            termination,
                        }) => {
                            if finished != transport {
                                continue;
                            }
                            if !self.is_active(run_id, scope, stop_token) {
                                return None;
                            }
                            return Some(termination);
                        }
                        Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            return None;
                        }
                    }
                }
                _ = tokio::time::sleep(RETRY_SLEEP_POLL_INTERVAL) => {}
            }
        }
    }

    async fn probe_auth_session(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        attempt: u32,
    ) {
        let result = self
            .web
            .execute_api(
                current_user_get_input(session.endpoint.clone()),
                ApiScope::Vrchat,
                self.db.as_ref(),
            )
            .await;
        match result {
            Ok(response) => {
                self.trail(
                    "authProbe",
                    json!({
                        "runId": run_id,
                        "attempt": attempt,
                        "probeStatus": response.status,
                    }),
                );
                if matches!(response.status, 401 | 403) {
                    self.emit_auth_failure_if_needed(
                        scope,
                        "runtime/realtime-auth-probe",
                        &Error::Custom(format!(
                            "Realtime auth probe was rejected (HTTP {}).",
                            response.status
                        )),
                    );
                }
            }
            Err(error) => self.trail(
                "authProbe",
                json!({
                    "runId": run_id,
                    "attempt": attempt,
                    "reason": error.to_string(),
                }),
            ),
        }
    }

    fn trail(&self, kind: &str, fields: Value) {
        vrcx_0_application_realtime::realtime_lifecycle_log::record(
            self.db.db_path(),
            kind,
            fields,
        );
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
        let Some(status_code) = auth_failure_status(&reason) else {
            return;
        };
        if !self.auth_scope.snapshot().generation_matches(scope) {
            return;
        }
        self.event_bus
            .emit_runtime_vrchat_auth_failure(RuntimeVrchatAuthFailurePayload {
                owner_user_id: scope.current_user_id.clone(),
                endpoint: scope.endpoint.clone(),
                path: path.to_string(),
                reason,
                status_code,
                auth_scope_generation: scope.generation,
                realtime_transport: None,
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
            && self.auth_scope.snapshot().generation_matches(scope)
            && matches!(
                self.lock_snapshot().phase,
                AuthenticatedRuntimePhase::Starting | AuthenticatedRuntimePhase::Ready
            )
    }

    async fn wait_for_retry(
        &self,
        delay_seconds: u64,
        run_id: u64,
        scope: &RuntimeAuthScopeSnapshot,
        stop_token: &TaskStopToken,
    ) -> bool {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(delay_seconds);
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return false;
            }
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            let sleep_for = remaining.min(RETRY_SLEEP_POLL_INTERVAL);
            tokio::time::sleep(sleep_for).await;
        }
        self.is_active(run_id, scope, stop_token)
    }

    fn set_step_running(&self, run_id: u64, step: RuntimeStep, attempt: u32) {
        self.update_snapshot(run_id, |snapshot| {
            if matches!(step, RuntimeStep::Realtime) {
                snapshot.realtime_transport = None;
            }
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
            if matches!(step, RuntimeStep::Realtime) {
                snapshot.realtime_transport = None;
            }
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

    fn mark_ready_if_complete(&self, run_id: u64) {
        let snapshot = {
            let mut snapshot = self.lock_snapshot();
            if snapshot.run_id != run_id
                || snapshot.phase != AuthenticatedRuntimePhase::Starting
                || !all_steps_ready(&snapshot)
            {
                return;
            }
            snapshot.phase = AuthenticatedRuntimePhase::Ready;
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

fn commit_friend_baseline(
    snapshot: &mut AuthenticatedRuntimePhaseSnapshot,
    attempt: u32,
    output: SocialFriendRosterBaselineOutput,
) {
    snapshot.friends = ready_step(attempt, format!("{} friends loaded.", output.count));
    snapshot.friend_baseline_revision = snapshot.friend_baseline_revision.saturating_add(1);
    snapshot.friend_baseline = Some(output);
}

fn all_steps_ready(snapshot: &AuthenticatedRuntimePhaseSnapshot) -> bool {
    [
        snapshot.friends.status,
        snapshot.favorites.status,
        snapshot.realtime.status,
    ]
    .into_iter()
    .all(|status| status == AuthenticatedRuntimeStepStatus::Ready)
}

fn apply_realtime_connected(
    snapshot: &mut AuthenticatedRuntimePhaseSnapshot,
    attempt: u32,
    transport: &RealtimeTransportStartResult,
) {
    if snapshot.realtime_transport.as_ref() != Some(transport) {
        return;
    }
    snapshot.realtime = ready_step(attempt, "Realtime transport connected.".into());
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

fn auth_failure_status(reason: &str) -> Option<i32> {
    let reason = reason.to_ascii_lowercase();
    if reason.contains("missing credentials") || reason.contains("http 401") {
        Some(401)
    } else if reason.contains("http 403") {
        Some(403)
    } else {
        None
    }
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

pub fn favorite_group_membership_from_baseline(
    snapshot: &FavoriteBaselineSnapshot,
) -> HashMap<String, Vec<String>> {
    let mut groups = HashMap::new();
    append_typed_favorite_group_membership(
        &mut groups,
        &snapshot.grouped_favorite_friend_ids_by_group_key,
        "",
    );
    append_typed_favorite_group_membership(&mut groups, &snapshot.local_friend_favorites, "local:");
    groups
}

pub fn favorite_world_group_membership_from_baseline(
    snapshot: &FavoriteBaselineSnapshot,
) -> HashMap<String, Vec<String>> {
    let mut groups = HashMap::new();
    append_typed_favorite_group_membership(
        &mut groups,
        &snapshot.grouped_favorite_world_ids_by_group_key,
        "",
    );
    append_typed_favorite_group_membership(&mut groups, &snapshot.local_world_favorites, "local:");
    groups
}

fn append_typed_favorite_group_membership(
    groups: &mut HashMap<String, Vec<String>>,
    memberships: &std::collections::BTreeMap<String, Vec<String>>,
    key_prefix: &str,
) {
    for (group_key, entity_ids) in memberships {
        let entity_ids = entity_ids
            .iter()
            .map(|entity_id| entity_id.trim())
            .filter(|entity_id| !entity_id.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !entity_ids.is_empty() {
            groups.insert(format!("{key_prefix}{group_key}"), entity_ids);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn typed_favorite_membership_normalizes_ids_and_prefixes_local_groups() {
        let memberships = std::collections::BTreeMap::from([(
            "Friends".to_string(),
            vec![" usr_one ".to_string(), String::new()],
        )]);
        let mut groups = HashMap::new();

        append_typed_favorite_group_membership(&mut groups, &memberships, "local:");

        assert_eq!(
            groups,
            HashMap::from([("local:Friends".to_string(), vec!["usr_one".to_string()])])
        );
    }

    #[test]
    fn retry_schedule_caps_at_sixty_seconds() {
        assert_eq!(retry_delay_seconds(1), 5);
        assert_eq!(retry_delay_seconds(2), 15);
        assert_eq!(retry_delay_seconds(3), 30);
        assert_eq!(retry_delay_seconds(4), 60);
        assert_eq!(retry_delay_seconds(20), 60);
    }

    #[test]
    fn recognizes_baseline_auth_failures() {
        assert_eq!(auth_failure_status("Missing Credentials (401)"), Some(401));
        assert_eq!(auth_failure_status("Unauthorized (HTTP 401)"), Some(401));
        assert_eq!(auth_failure_status("Forbidden (HTTP 403)"), Some(403));
        assert_eq!(auth_failure_status("request timed out"), None);
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
    fn realtime_lifecycle_requires_matching_transport_identity() {
        let transport = RealtimeTransportStartResult {
            generation: 2,
            client_run_id: 4,
            session_generation: 6,
        };
        let mut snapshot = AuthenticatedRuntimePhaseSnapshot {
            realtime_transport: Some(transport.clone()),
            ..Default::default()
        };
        let stale = RealtimeTransportStartResult {
            generation: 1,
            ..transport.clone()
        };

        apply_realtime_connected(&mut snapshot, 1, &stale);
        assert_eq!(
            snapshot.realtime.status,
            AuthenticatedRuntimeStepStatus::Pending
        );

        apply_realtime_connected(&mut snapshot, 1, &transport);
        assert_eq!(
            snapshot.realtime.status,
            AuthenticatedRuntimeStepStatus::Ready
        );
    }

    #[test]
    fn runtime_is_ready_only_after_every_step_is_ready() {
        let mut snapshot = AuthenticatedRuntimePhaseSnapshot {
            friends: ready_step(1, "friends".into()),
            favorites: ready_step(1, "favorites".into()),
            ..Default::default()
        };
        assert!(!all_steps_ready(&snapshot));

        snapshot.realtime = ready_step(1, "realtime".into());
        assert!(all_steps_ready(&snapshot));
    }

    #[test]
    fn each_successful_friend_rebaseline_advances_the_phase_revision() {
        let mut snapshot = AuthenticatedRuntimePhaseSnapshot::default();
        let output = SocialFriendRosterBaselineOutput {
            user_id: "usr_self".into(),
            stale: false,
            count: 1,
            detail: "Friends ready.".into(),
            snapshot: Some(RawJson::from(json!({"friendsById": {}}))),
            friend_log_changed: false,
        };

        commit_friend_baseline(&mut snapshot, 1, output.clone());
        assert_eq!(snapshot.friend_baseline_revision, 1);

        commit_friend_baseline(&mut snapshot, 1, output);
        assert_eq!(snapshot.friend_baseline_revision, 2);
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
