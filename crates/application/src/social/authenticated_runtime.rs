use futures_util::future::BoxFuture;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use crate::auth::{
    AuthenticatedRuntimePhase, AuthenticatedRuntimePhaseObserver,
    AuthenticatedRuntimePhaseSnapshot, AuthenticatedRuntimeSession,
};
use serde_json::{json, Value};
use vrcx_0_application_core::{
    Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeEventBus, TaskStopToken,
    TaskSupervisor,
};
use vrcx_0_application_realtime::{
    FavoriteBaselineSnapshot, RealtimeHostRuntime, RealtimeStopRequest, SocialBaselineDeps,
    SocialFavoritesBaselineOutput,
};
use vrcx_0_core::time::now_iso;

mod baselines;
mod reconnect;
mod state;
mod transport;

pub use baselines::{
    favorite_group_membership_from_baseline, favorite_world_group_membership_from_baseline,
    friend_ids_by_roster_id_from_records, FavoriteGroupMemberships,
};

use baselines::accept_favorites_baseline;
use reconnect::{random_retry_delay, RetryWake, SystemResumeWatch};
use state::{
    assemble_authenticated_runtime_snapshot, snapshot_matches_session, AuthenticatedRuntimeState,
    RuntimeStep,
};

const TRANSPORT_MONITOR_POLL_INTERVAL: Duration = Duration::from_millis(250);

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

    fn trail(&self, kind: &str, fields: Value) {
        self.lifecycle_trail.record(kind, fields);
    }

    pub fn social_baseline_deps(&self) -> SocialBaselineDeps {
        self.social_baseline.clone()
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

#[cfg(test)]
mod tests;
