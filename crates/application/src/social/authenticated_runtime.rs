use futures_util::future::BoxFuture;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use crate::auth::{
    AuthenticatedRuntimePhase, AuthenticatedRuntimePhaseObserver,
    AuthenticatedRuntimePhaseSnapshot, AuthenticatedRuntimeRealtimeHealth,
    AuthenticatedRuntimeSession, AuthenticatedRuntimeStepSnapshot, AuthenticatedRuntimeStepStatus,
};
use serde_json::{json, Value};
use vrcx_0_application_core::{
    Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus,
    RuntimeVrchatAuthFailurePayload, TaskStopToken, TaskSupervisor,
};
use vrcx_0_application_realtime::{
    build_favorites_baseline_from_friend_ids, build_synced_friend_roster_baseline,
    FavoriteBaselineSnapshot, RealtimeFriendRosterSnapshot, RealtimeHostRuntime,
    RealtimeStopRequest, RealtimeTransportLifecycleEvent, RealtimeTransportStartResult,
    RealtimeTransportTermination, SocialBaselineDeps, SocialFavoritesBaselineOutput,
    SocialFavoritesBaselineRequest, SocialFriendRosterBaselineInput,
    SocialFriendRosterBaselineOutput,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::time::{iso_millis, now_iso};
use vrcx_0_core::OwnerId;

mod reconnect;

use reconnect::{random_retry_delay, RealtimeOutage, RetryWake, SystemResumeWatch};

const TRANSPORT_MONITOR_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy)]
enum RuntimeStep {
    Friends,
    Favorites,
    Realtime,
}

pub type AuthenticatedRuntimeProbeFuture<'a> = BoxFuture<'a, Result<i32>>;

pub trait AuthenticatedRuntimeAuthProbe: Send + Sync {
    fn probe<'a>(&'a self, endpoint: &'a str) -> AuthenticatedRuntimeProbeFuture<'a>;
}

pub trait AuthenticatedRuntimeLifecycleTrail: Send + Sync {
    fn record(&self, kind: &str, fields: Value);
}

pub trait AuthenticatedRuntimeFavoritesSink: Send + Sync {
    fn apply(&self, snapshot: &FavoriteBaselineSnapshot);
}

impl<F> AuthenticatedRuntimeFavoritesSink for F
where
    F: Fn(&FavoriteBaselineSnapshot) + Send + Sync,
{
    fn apply(&self, snapshot: &FavoriteBaselineSnapshot) {
        self(snapshot);
    }
}

pub struct AuthenticatedRuntimeDeps {
    pub social_baseline: SocialBaselineDeps,
    pub auth_probe: Arc<dyn AuthenticatedRuntimeAuthProbe>,
    pub lifecycle_trail: Arc<dyn AuthenticatedRuntimeLifecycleTrail>,
    pub event_bus: RuntimeEventBus,
    pub tasks: TaskSupervisor,
    pub auth_scope: RuntimeAuthScope,
    pub realtime_runtime: Arc<RealtimeHostRuntime>,
    pub favorites_sink: Option<Arc<dyn AuthenticatedRuntimeFavoritesSink>>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct FavoriteGroupMemberships {
    pub friend_groups_by_key: HashMap<String, Vec<String>>,
    pub world_groups_by_key: HashMap<String, Vec<String>>,
}

pub fn friend_ids_by_roster_id_from_records(
    friends_by_id: HashMap<String, FriendRecord>,
) -> HashMap<String, String> {
    friends_by_id
        .into_iter()
        .map(|(roster_id, friend)| {
            let friend_id = friend.id.trim().to_string();
            let friend_id = if friend_id.is_empty() {
                roster_id.clone()
            } else {
                friend_id
            };
            (roster_id, friend_id)
        })
        .collect()
}

#[derive(Clone)]
pub struct AuthenticatedRuntimeOrchestrator {
    shared: Arc<AuthenticatedRuntimeShared>,
    social_baseline: SocialBaselineDeps,
    auth_probe: Arc<dyn AuthenticatedRuntimeAuthProbe>,
    lifecycle_trail: Arc<dyn AuthenticatedRuntimeLifecycleTrail>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    auth_scope: RuntimeAuthScope,
    realtime_runtime: Arc<RealtimeHostRuntime>,
    favorites_sink: Option<Arc<dyn AuthenticatedRuntimeFavoritesSink>>,
}

struct AuthenticatedRuntimeShared {
    state: Mutex<AuthenticatedRuntimeState>,
    generation: AtomicU64,
    retry_wake: RetryWake,
    resume_watch: SystemResumeWatch,
    phase_observers: Mutex<Vec<AuthenticatedRuntimePhaseObserver>>,
}

#[derive(Default)]
struct AuthenticatedRuntimeState {
    phase: AuthenticatedRuntimePhaseSnapshot,
    friend_baseline: Option<FriendBaselineMetadata>,
    favorites_baseline: Option<SocialFavoritesBaselineOutput>,
    favorite_group_memberships: Option<Arc<FavoriteGroupMemberships>>,
    realtime_outage: RealtimeOutage,
}

#[derive(Clone, Debug)]
struct FriendBaselineMetadata {
    user_id: String,
    stale: bool,
    detail: String,
}

impl AuthenticatedRuntimeOrchestrator {
    pub fn new(deps: AuthenticatedRuntimeDeps) -> Self {
        Self {
            shared: Arc::new(AuthenticatedRuntimeShared {
                state: Mutex::new(AuthenticatedRuntimeState::default()),
                generation: AtomicU64::new(0),
                retry_wake: RetryWake::default(),
                resume_watch: SystemResumeWatch::default(),
                phase_observers: Mutex::new(Vec::new()),
            }),
            social_baseline: deps.social_baseline,
            auth_probe: deps.auth_probe,
            lifecycle_trail: deps.lifecycle_trail,
            event_bus: deps.event_bus,
            tasks: deps.tasks,
            auth_scope: deps.auth_scope,
            realtime_runtime: deps.realtime_runtime,
            favorites_sink: deps.favorites_sink,
        }
    }

    pub fn snapshot(&self) -> AuthenticatedRuntimePhaseSnapshot {
        let (snapshot, friend_baseline, favorites_baseline) = {
            let state = self.lock_state();
            (
                state.phase.clone(),
                state.friend_baseline.clone(),
                state.favorites_baseline.clone(),
            )
        };
        let current_friends = match friend_baseline.as_ref() {
            Some(_) => self.realtime_runtime.friend_roster_snapshot(),
            None => None,
        };
        assemble_authenticated_runtime_snapshot(
            snapshot,
            friend_baseline,
            current_friends,
            favorites_baseline,
        )
    }

    fn phase_snapshot(&self) -> AuthenticatedRuntimePhaseSnapshot {
        self.lock_state().phase.clone()
    }

    pub fn add_phase_observer(&self, observer: AuthenticatedRuntimePhaseObserver) {
        self.shared
            .phase_observers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(observer);
    }

    pub fn update_favorites_baseline(&self, output: SocialFavoritesBaselineOutput) {
        let accepted = accept_favorites_baseline(&mut self.lock_state(), output);
        if let Some(snapshot) = accepted {
            self.apply_favorites_snapshot(&snapshot);
        }
    }

    pub fn favorite_friend_group_membership(&self) -> Option<HashMap<String, Vec<String>>> {
        self.lock_state()
            .favorite_group_memberships
            .as_ref()
            .map(|memberships| memberships.friend_groups_by_key.clone())
    }

    pub fn favorite_group_memberships(&self) -> Option<Arc<FavoriteGroupMemberships>> {
        self.lock_state().favorite_group_memberships.clone()
    }

    pub fn apply_favorites_snapshot(&self, snapshot: &FavoriteBaselineSnapshot) {
        if let Some(favorites_sink) = &self.favorites_sink {
            favorites_sink.apply(snapshot);
        }
    }

    pub fn start(
        &self,
        session: AuthenticatedRuntimeSession,
        scope: RuntimeAuthScopeSnapshot,
    ) -> Result<AuthenticatedRuntimePhaseSnapshot> {
        if session.user_id.trim().is_empty() {
            return Err(Error::Custom(
                "Authenticated runtime requires an authenticated user id.".into(),
            ));
        }

        let current = self.phase_snapshot();
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
        let run_id = self.shared.generation.fetch_add(1, Ordering::AcqRel) + 1;
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
        *self.lock_state() = AuthenticatedRuntimeState {
            phase: snapshot.clone(),
            ..Default::default()
        };
        self.emit(snapshot.clone());

        let runtime = self.clone();
        self.tasks.spawn_cancellable(move |stop_token| async move {
            runtime.run(session, scope, run_id, stop_token).await;
        });
        Ok(snapshot)
    }

    pub fn stop(&self) -> AuthenticatedRuntimePhaseSnapshot {
        let previous = self.phase_snapshot();
        if matches!(
            previous.phase,
            AuthenticatedRuntimePhase::Idle | AuthenticatedRuntimePhase::Stopped
        ) {
            return previous;
        }
        let run_id = self.shared.generation.fetch_add(1, Ordering::AcqRel) + 1;
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
        *self.lock_state() = AuthenticatedRuntimeState {
            phase: snapshot.clone(),
            ..Default::default()
        };
        self.emit(snapshot.clone());
        snapshot
    }

    pub fn retry_now(&self) {
        self.shared.retry_wake.wake();
        self.trail(
            "retryNowRequested",
            json!({ "runId": self.shared.generation.load(Ordering::Acquire) }),
        );
    }

    pub fn start_system_resume_watch<F>(&self, on_resume: F)
    where
        F: Fn() + Send + 'static,
    {
        let runtime = self.clone();
        self.shared.resume_watch.start(&self.tasks, move || {
            runtime.handle_system_resume();
            on_resume();
        });
    }

    fn handle_system_resume(&self) {
        self.shared.retry_wake.wake_after_resume();
        self.realtime_runtime.verify_transport_liveness();
        self.trail(
            "systemResumed",
            json!({ "runId": self.shared.generation.load(Ordering::Acquire) }),
        );
    }

    async fn run(
        &self,
        session: AuthenticatedRuntimeSession,
        scope: RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: TaskStopToken,
    ) {
        let Some(friend_ids_by_roster_id) = self
            .run_friend_baseline(&session, &scope, run_id, &stop_token)
            .await
        else {
            return;
        };
        if !self.is_active(run_id, &scope, &stop_token) {
            return;
        }

        let favorites = self.run_favorites_baseline(
            &session,
            &scope,
            run_id,
            &stop_token,
            &friend_ids_by_roster_id,
        );
        let realtime = self.run_realtime_with_rebaseline(&session, &scope, run_id, &stop_token);
        tokio::join!(favorites, realtime);
    }

    async fn run_realtime_with_rebaseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
    ) {
        let mut attempt: u32 = 1;
        let mut roster_stale = false;
        loop {
            let termination = self
                .run_realtime_transport(session, scope, run_id, stop_token, attempt)
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

            self.mark_realtime_lost(run_id);
            if !self
                .wait_before_retry(
                    run_id,
                    RuntimeStep::Realtime,
                    attempt,
                    reason,
                    scope,
                    stop_token,
                )
                .await
            {
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
                    Ok(Some(friend_ids_by_roster_id)) => {
                        self.trail(
                            "rebaselined",
                            json!({
                                "runId": run_id,
                                "attempt": attempt,
                                "friends": friend_ids_by_roster_id.len(),
                            }),
                        );
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
    ) -> Option<HashMap<String, String>> {
        let mut attempt = 1;
        loop {
            match self
                .try_friend_baseline(session, scope, run_id, stop_token, attempt)
                .await
            {
                Ok(Some(friend_ids_by_roster_id)) => return Some(friend_ids_by_roster_id),
                Ok(None) => return None,
                Err(error) => {
                    if !self
                        .wait_before_retry(
                            run_id,
                            RuntimeStep::Friends,
                            attempt,
                            error.to_string(),
                            scope,
                            stop_token,
                        )
                        .await
                    {
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
    ) -> Result<Option<HashMap<String, String>>> {
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
                current_user_snapshot: session.current_user.clone(),
                is_first_load: true,
            },
        )
        .await
        .and_then(|baseline| {
            let output = baseline.output;
            match baseline.friends_by_id {
                Some(friends_by_id) => {
                    Ok((output, friend_ids_by_roster_id_from_records(friends_by_id)))
                }
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
            Ok((mut output, friend_ids_by_roster_id)) => {
                if output.detail.trim().is_empty() {
                    output.detail = format!(
                        "Friend roster baseline loaded for {}.",
                        session.display_name
                    );
                }
                self.update_friend_baseline(run_id, attempt, output);
                Ok(Some(friend_ids_by_roster_id))
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
        friend_ids_by_roster_id: &HashMap<String, String>,
    ) {
        let mut attempt = 1;
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return;
            }
            self.set_step_running(run_id, RuntimeStep::Favorites, attempt);
            let result = build_favorites_baseline_from_friend_ids(
                self.social_baseline_deps(),
                SocialFavoritesBaselineRequest {
                    user_id: session.user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    current_user_snapshot: session.current_user.clone(),
                },
                friend_ids_by_roster_id,
            )
            .await;
            if !self.is_active(run_id, scope, stop_token) {
                return;
            }

            match result.and_then(require_favorites_baseline) {
                Ok(output) => {
                    if let Some(snapshot) = output.snapshot.as_ref() {
                        self.apply_favorites_snapshot(snapshot);
                    }
                    self.update_favorites_step_baseline(run_id, attempt, output);
                    self.mark_ready_if_complete(run_id);
                    return;
                }
                Err(error) => {
                    self.emit_auth_failure_if_needed(
                        scope,
                        "runtime/social-baseline/favorites",
                        &error,
                    );
                    if !self
                        .wait_before_retry(
                            run_id,
                            RuntimeStep::Favorites,
                            attempt,
                            error.to_string(),
                            scope,
                            stop_token,
                        )
                        .await
                    {
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
    ) -> Option<RealtimeTransportTermination> {
        if !self.is_active(run_id, scope, stop_token) {
            return None;
        }
        self.set_step_running(run_id, RuntimeStep::Realtime, attempt);
        let mut lifecycle = self.realtime_runtime.subscribe_transport_lifecycle();
        let result = match self.realtime_runtime.start_from_friend_baseline(
            session.user_id.clone(),
            session.endpoint.clone(),
            session.websocket.clone(),
            run_id,
            session.current_user.as_value().clone(),
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
            self.refresh_realtime_interruption(run_id);
            tokio::select! {
                event = lifecycle.recv() => {
                    match event {
                        Ok(RealtimeTransportLifecycleEvent::Connected(connected))
                            if connected == transport =>
                        {
                            self.update_state(run_id, |state| {
                                if apply_realtime_connected(&mut state.phase, attempt, &transport) {
                                    state.realtime_outage.end();
                                }
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
                _ = tokio::time::sleep(TRANSPORT_MONITOR_POLL_INTERVAL) => {}
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
        let result = self.auth_probe.probe(&session.endpoint).await;
        match result {
            Ok(status) => {
                self.trail(
                    "authProbe",
                    json!({
                        "runId": run_id,
                        "attempt": attempt,
                        "probeStatus": status,
                    }),
                );
                if matches!(status, 401 | 403) {
                    self.emit_auth_failure_if_needed(
                        scope,
                        "runtime/realtime-auth-probe",
                        &Error::VrchatApi {
                            status_code: status,
                            message: format!("Realtime auth probe was rejected (HTTP {}).", status),
                        },
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
        self.lifecycle_trail.record(kind, fields);
    }

    fn social_baseline_deps(&self) -> SocialBaselineDeps {
        self.social_baseline.clone()
    }

    fn emit_auth_failure_if_needed(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        path: &str,
        error: &Error,
    ) {
        let Some(status_code) = vrchat_auth_failure_status(error) else {
            return;
        };
        let reason = error.to_string();
        if !self.auth_scope.snapshot().generation_matches(scope) {
            return;
        }
        self.auth_scope.report_vrchat_auth_failure(
            &self.event_bus,
            RuntimeVrchatAuthFailurePayload {
                owner_user_id: OwnerId::new(scope.current_user_id.clone()),
                endpoint: scope.endpoint.clone(),
                path: path.to_string(),
                reason,
                status_code,
                auth_scope_generation: scope.generation,
                realtime_transport: None,
            },
        );
    }

    fn is_active(
        &self,
        run_id: u64,
        scope: &RuntimeAuthScopeSnapshot,
        stop_token: &TaskStopToken,
    ) -> bool {
        !stop_token.is_stop_requested()
            && self.shared.generation.load(Ordering::Acquire) == run_id
            && self.auth_scope.snapshot().generation_matches(scope)
            && matches!(
                self.lock_state().phase.phase,
                AuthenticatedRuntimePhase::Starting | AuthenticatedRuntimePhase::Ready
            )
    }

    async fn wait_before_retry(
        &self,
        run_id: u64,
        step: RuntimeStep,
        attempt: u32,
        error: String,
        scope: &RuntimeAuthScopeSnapshot,
        stop_token: &TaskStopToken,
    ) -> bool {
        let wake_epoch = self.shared.retry_wake.epoch();
        let delay = random_retry_delay(attempt);
        self.set_step_retry(run_id, step, attempt, delay, error);
        self.shared
            .retry_wake
            .wait(delay, wake_epoch, || {
                self.refresh_realtime_interruption(run_id);
                self.is_active(run_id, scope, stop_token)
            })
            .await
    }

    fn set_step_running(&self, run_id: u64, step: RuntimeStep, attempt: u32) {
        self.update_state(run_id, |state| {
            if matches!(step, RuntimeStep::Realtime) {
                state.phase.realtime_transport = None;
                state.phase.realtime_health.retry_at = None;
                state.realtime_outage.begin(tokio::time::Instant::now());
            }
            *step_snapshot_mut(&mut state.phase, step) = AuthenticatedRuntimeStepSnapshot {
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
        delay: Duration,
        error: String,
    ) {
        self.update_snapshot(run_id, |snapshot| {
            if matches!(step, RuntimeStep::Realtime) {
                snapshot.realtime_transport = None;
                snapshot.realtime_health.retry_at = chrono::Duration::from_std(delay)
                    .ok()
                    .map(|delay| iso_millis(chrono::Utc::now() + delay));
            }
            *step_snapshot_mut(snapshot, step) = AuthenticatedRuntimeStepSnapshot {
                status: AuthenticatedRuntimeStepStatus::RetryWaiting,
                attempt,
                retry_delay_seconds: Some(delay.as_secs_f64().ceil() as u64),
                detail: format!("{} retry is waiting.", step_name(step)),
                last_error: Some(error),
            };
        });
    }

    fn mark_realtime_lost(&self, run_id: u64) {
        self.update_state(run_id, |state| {
            if !state.realtime_outage.is_ongoing() {
                state.phase.realtime_health.disconnected_at = Some(now_iso());
            }
            state.realtime_outage.begin(tokio::time::Instant::now());
        });
    }

    fn refresh_realtime_interruption(&self, run_id: u64) {
        let snapshot = {
            let mut state = self.lock_state();
            if state.phase.run_id != run_id
                || state.phase.realtime_health.interrupted
                || !state
                    .realtime_outage
                    .past_grace(tokio::time::Instant::now())
            {
                return;
            }
            state.phase.realtime_health.interrupted = true;
            finish_state_update(&mut state)
        };
        self.emit(snapshot);
    }

    fn update_snapshot(
        &self,
        run_id: u64,
        update: impl FnOnce(&mut AuthenticatedRuntimePhaseSnapshot),
    ) {
        self.update_state(run_id, |state| update(&mut state.phase));
    }

    fn update_state(&self, run_id: u64, update: impl FnOnce(&mut AuthenticatedRuntimeState)) {
        let snapshot = {
            let mut state = self.lock_state();
            if state.phase.run_id != run_id {
                return;
            }
            update(&mut state);
            finish_state_update(&mut state)
        };
        self.emit(snapshot);
    }

    fn update_friend_baseline(
        &self,
        run_id: u64,
        attempt: u32,
        output: SocialFriendRosterBaselineOutput,
    ) {
        let snapshot = {
            let mut state = self.lock_state();
            if state.phase.run_id != run_id {
                return;
            }
            commit_friend_baseline(&mut state, attempt, output)
        };
        self.emit(snapshot);
    }

    fn update_favorites_step_baseline(
        &self,
        run_id: u64,
        attempt: u32,
        output: SocialFavoritesBaselineOutput,
    ) {
        let snapshot = {
            let mut state = self.lock_state();
            if state.phase.run_id != run_id {
                return;
            }
            commit_favorites_baseline(&mut state, attempt, output)
        };
        self.emit(snapshot);
    }

    fn mark_ready_if_complete(&self, run_id: u64) {
        let snapshot = {
            let mut state = self.lock_state();
            if state.phase.run_id != run_id
                || state.phase.phase != AuthenticatedRuntimePhase::Starting
                || !all_steps_ready(&state.phase)
            {
                return;
            }
            state.phase.phase = AuthenticatedRuntimePhase::Ready;
            state.phase.updated_at = now_iso();
            state.phase.clone()
        };
        self.emit(snapshot);
    }

    fn emit(&self, snapshot: AuthenticatedRuntimePhaseSnapshot) {
        let observers = self
            .shared
            .phase_observers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        for observer in &observers {
            observer(&snapshot);
        }
        self.event_bus.emit(snapshot);
    }

    fn lock_state(&self) -> MutexGuard<'_, AuthenticatedRuntimeState> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn finish_state_update(state: &mut AuthenticatedRuntimeState) -> AuthenticatedRuntimePhaseSnapshot {
    state.phase.friend_baseline = None;
    state.phase.favorites_baseline = None;
    state.phase.updated_at = now_iso();
    state.phase.clone()
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
    state: &mut AuthenticatedRuntimeState,
    attempt: u32,
    output: SocialFriendRosterBaselineOutput,
) -> AuthenticatedRuntimePhaseSnapshot {
    state.phase.friends = ready_step(attempt, format!("{} friends loaded.", output.count));
    state.phase.friend_baseline_revision = state.phase.friend_baseline_revision.saturating_add(1);
    state.friend_baseline = Some(friend_baseline_metadata(&output));
    state.phase.friend_baseline = None;
    state.phase.favorites_baseline = None;
    state.phase.updated_at = now_iso();
    let mut emitted = state.phase.clone();
    emitted.friend_baseline = Some(output);
    emitted
}

fn commit_favorites_baseline(
    state: &mut AuthenticatedRuntimeState,
    attempt: u32,
    output: SocialFavoritesBaselineOutput,
) -> AuthenticatedRuntimePhaseSnapshot {
    state.phase.favorites = ready_step(attempt, format!("{} favorites loaded.", output.count));
    state.favorite_group_memberships = output
        .snapshot
        .as_ref()
        .map(favorite_group_memberships_from_baseline)
        .map(Arc::new);
    state.favorites_baseline = Some(output.clone());
    state.phase.friend_baseline = None;
    state.phase.favorites_baseline = None;
    state.phase.updated_at = now_iso();
    let mut emitted = state.phase.clone();
    emitted.favorites_baseline = Some(output);
    emitted
}

fn friend_baseline_metadata(output: &SocialFriendRosterBaselineOutput) -> FriendBaselineMetadata {
    FriendBaselineMetadata {
        user_id: output.user_id.clone(),
        stale: output.stale,
        detail: output.detail.clone(),
    }
}

fn current_friend_baseline_output(
    metadata: FriendBaselineMetadata,
    current: RealtimeFriendRosterSnapshot,
) -> SocialFriendRosterBaselineOutput {
    SocialFriendRosterBaselineOutput {
        user_id: metadata.user_id,
        stale: metadata.stale,
        count: crate::wire_count(current.friend_count),
        detail: metadata.detail,
        snapshot: Some(current.snapshot),
        friend_log_changed: false,
    }
}

fn assemble_authenticated_runtime_snapshot(
    mut snapshot: AuthenticatedRuntimePhaseSnapshot,
    friend_baseline: Option<FriendBaselineMetadata>,
    current_friends: Option<RealtimeFriendRosterSnapshot>,
    favorites_baseline: Option<SocialFavoritesBaselineOutput>,
) -> AuthenticatedRuntimePhaseSnapshot {
    snapshot.favorites_baseline = favorites_baseline;
    let (Some(friend_baseline), Some(current_friends)) = (friend_baseline, current_friends) else {
        return snapshot;
    };
    if current_friends.current_user_id != snapshot.user_id
        || current_friends.endpoint != snapshot.endpoint
        || current_friends.websocket != snapshot.websocket
        || friend_baseline.user_id != snapshot.user_id
    {
        return snapshot;
    }
    snapshot.friend_baseline = Some(current_friend_baseline_output(
        friend_baseline,
        current_friends,
    ));
    snapshot
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
) -> bool {
    if snapshot.realtime_transport.as_ref() != Some(transport) {
        return false;
    }
    snapshot.realtime = ready_step(attempt, "Realtime transport connected.".into());
    snapshot.realtime_health = AuthenticatedRuntimeRealtimeHealth::default();
    true
}

fn accept_favorites_baseline(
    state: &mut AuthenticatedRuntimeState,
    output: SocialFavoritesBaselineOutput,
) -> Option<FavoriteBaselineSnapshot> {
    if output.stale
        || state.phase.user_id != output.user_id
        || !matches!(
            state.phase.phase,
            AuthenticatedRuntimePhase::Starting | AuthenticatedRuntimePhase::Ready
        )
    {
        return None;
    }
    let snapshot = output.snapshot.clone()?;
    state.favorite_group_memberships = Some(Arc::new(favorite_group_memberships_from_baseline(
        &snapshot,
    )));
    state.favorites_baseline = Some(output);
    state.phase.updated_at = now_iso();
    Some(snapshot)
}

fn require_favorites_baseline(
    output: SocialFavoritesBaselineOutput,
) -> Result<SocialFavoritesBaselineOutput> {
    if output.stale || output.snapshot.is_none() {
        return Err(Error::Custom("Favorites baseline was stale.".into()));
    }
    Ok(output)
}

fn vrchat_auth_failure_status(error: &Error) -> Option<i32> {
    match error {
        Error::VrchatApi {
            status_code: status_code @ (401 | 403),
            ..
        } => Some(*status_code),
        _ => None,
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

fn favorite_group_memberships_from_baseline(
    snapshot: &FavoriteBaselineSnapshot,
) -> FavoriteGroupMemberships {
    FavoriteGroupMemberships {
        friend_groups_by_key: favorite_group_membership_from_baseline(snapshot),
        world_groups_by_key: favorite_world_group_membership_from_baseline(snapshot),
    }
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
mod tests;
