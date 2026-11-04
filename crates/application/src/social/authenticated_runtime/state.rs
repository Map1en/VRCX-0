use std::sync::Arc;
use std::time::Duration;

use crate::auth::{
    AuthenticatedRuntimePhase, AuthenticatedRuntimePhaseSnapshot,
    AuthenticatedRuntimeRealtimeHealth, AuthenticatedRuntimeSession,
    AuthenticatedRuntimeStepSnapshot, AuthenticatedRuntimeStepStatus,
};
use vrcx_0_application_realtime::{
    RealtimeFriendRosterSnapshot, RealtimeTransportStartResult, SocialFavoritesBaselineOutput,
    SocialFriendRosterBaselineOutput,
};
use vrcx_0_core::time::{iso_millis, now_iso};

use super::baselines::{
    commit_favorites_baseline, commit_friend_baseline, FavoriteGroupMemberships,
};
use super::reconnect::RealtimeOutage;
use super::AuthenticatedRuntimeOrchestrator;

#[derive(Clone, Copy)]
pub(super) enum RuntimeStep {
    Friends,
    Favorites,
    Realtime,
}

#[derive(Default)]
pub(super) struct AuthenticatedRuntimeState {
    pub(super) phase: AuthenticatedRuntimePhaseSnapshot,
    pub(super) friend_baseline: Option<FriendBaselineMetadata>,
    pub(super) favorites_baseline: Option<SocialFavoritesBaselineOutput>,
    pub(super) favorite_group_memberships: Option<Arc<FavoriteGroupMemberships>>,
    pub(super) realtime_outage: RealtimeOutage,
}

#[derive(Clone, Debug)]
pub(super) struct FriendBaselineMetadata {
    user_id: String,
    stale: bool,
    detail: String,
}

impl AuthenticatedRuntimeState {
    pub(super) fn set_step_running(
        &mut self,
        run_id: u64,
        step: RuntimeStep,
        attempt: u32,
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
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
        })
    }

    pub(super) fn set_step_retry(
        &mut self,
        run_id: u64,
        step: RuntimeStep,
        attempt: u32,
        delay: Duration,
        error: String,
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
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
        })
    }

    pub(super) fn mark_realtime_lost(
        &mut self,
        run_id: u64,
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
        self.update_state(run_id, |state| {
            if !state.realtime_outage.is_ongoing() {
                state.phase.realtime_health.disconnected_at = Some(now_iso());
            }
            state.realtime_outage.begin(tokio::time::Instant::now());
        })
    }

    pub(super) fn refresh_realtime_interruption(
        &mut self,
        run_id: u64,
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
        if self.phase.run_id != run_id
            || self.phase.realtime_health.interrupted
            || !self.realtime_outage.past_grace(tokio::time::Instant::now())
        {
            return None;
        }
        self.phase.realtime_health.interrupted = true;
        Some(finish_state_update(self))
    }

    fn update_snapshot(
        &mut self,
        run_id: u64,
        update: impl FnOnce(&mut AuthenticatedRuntimePhaseSnapshot),
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
        self.update_state(run_id, |state| update(&mut state.phase))
    }

    pub(super) fn update_state(
        &mut self,
        run_id: u64,
        update: impl FnOnce(&mut AuthenticatedRuntimeState),
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
        if self.phase.run_id != run_id {
            return None;
        }
        update(self);
        Some(finish_state_update(self))
    }

    pub(super) fn update_friend_baseline(
        &mut self,
        run_id: u64,
        attempt: u32,
        output: SocialFriendRosterBaselineOutput,
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
        if self.phase.run_id != run_id {
            return None;
        }
        Some(commit_friend_baseline(self, attempt, output))
    }

    pub(super) fn update_favorites_step_baseline(
        &mut self,
        run_id: u64,
        attempt: u32,
        output: SocialFavoritesBaselineOutput,
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
        if self.phase.run_id != run_id {
            return None;
        }
        Some(commit_favorites_baseline(self, attempt, output))
    }

    pub(super) fn mark_ready_if_complete(
        &mut self,
        run_id: u64,
    ) -> Option<AuthenticatedRuntimePhaseSnapshot> {
        if self.phase.run_id != run_id
            || self.phase.phase != AuthenticatedRuntimePhase::Starting
            || !all_steps_ready(&self.phase)
        {
            return None;
        }
        self.phase.phase = AuthenticatedRuntimePhase::Ready;
        self.phase.updated_at = now_iso();
        Some(self.phase.clone())
    }
}

impl AuthenticatedRuntimeOrchestrator {
    pub(super) fn set_step_running(&self, run_id: u64, step: RuntimeStep, attempt: u32) {
        let snapshot = self.lock_state().set_step_running(run_id, step, attempt);
        if let Some(snapshot) = snapshot {
            self.emit(snapshot);
        }
    }

    pub(super) fn set_step_retry(
        &self,
        run_id: u64,
        step: RuntimeStep,
        attempt: u32,
        delay: Duration,
        error: String,
    ) {
        let snapshot = self
            .lock_state()
            .set_step_retry(run_id, step, attempt, delay, error);
        if let Some(snapshot) = snapshot {
            self.emit(snapshot);
        }
    }

    pub(super) fn mark_realtime_lost(&self, run_id: u64) {
        let snapshot = self.lock_state().mark_realtime_lost(run_id);
        if let Some(snapshot) = snapshot {
            self.emit(snapshot);
        }
    }

    pub(super) fn refresh_realtime_interruption(&self, run_id: u64) {
        let snapshot = self.lock_state().refresh_realtime_interruption(run_id);
        if let Some(snapshot) = snapshot {
            self.emit(snapshot);
        }
    }

    pub(super) fn update_snapshot(
        &self,
        run_id: u64,
        update: impl FnOnce(&mut AuthenticatedRuntimePhaseSnapshot),
    ) {
        self.update_state(run_id, |state| update(&mut state.phase));
    }

    pub(super) fn update_state(
        &self,
        run_id: u64,
        update: impl FnOnce(&mut AuthenticatedRuntimeState),
    ) {
        let snapshot = self.lock_state().update_state(run_id, update);
        if let Some(snapshot) = snapshot {
            self.emit(snapshot);
        }
    }

    pub(super) fn update_friend_baseline(
        &self,
        run_id: u64,
        attempt: u32,
        output: SocialFriendRosterBaselineOutput,
    ) {
        let snapshot = self
            .lock_state()
            .update_friend_baseline(run_id, attempt, output);
        if let Some(snapshot) = snapshot {
            self.emit(snapshot);
        }
    }

    pub(super) fn update_favorites_step_baseline(
        &self,
        run_id: u64,
        attempt: u32,
        output: SocialFavoritesBaselineOutput,
    ) {
        let snapshot = self
            .lock_state()
            .update_favorites_step_baseline(run_id, attempt, output);
        if let Some(snapshot) = snapshot {
            self.emit(snapshot);
        }
    }

    pub(super) fn mark_ready_if_complete(&self, run_id: u64) {
        let snapshot = self.lock_state().mark_ready_if_complete(run_id);
        if let Some(snapshot) = snapshot {
            self.emit(snapshot);
        }
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

pub(super) fn ready_step(attempt: u32, detail: String) -> AuthenticatedRuntimeStepSnapshot {
    AuthenticatedRuntimeStepSnapshot {
        status: AuthenticatedRuntimeStepStatus::Ready,
        attempt,
        detail,
        ..Default::default()
    }
}

pub(super) fn friend_baseline_metadata(
    output: &SocialFriendRosterBaselineOutput,
) -> FriendBaselineMetadata {
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

pub(super) fn assemble_authenticated_runtime_snapshot(
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

pub(super) fn all_steps_ready(snapshot: &AuthenticatedRuntimePhaseSnapshot) -> bool {
    [
        snapshot.friends.status,
        snapshot.favorites.status,
        snapshot.realtime.status,
    ]
    .into_iter()
    .all(|status| status == AuthenticatedRuntimeStepStatus::Ready)
}

pub(super) fn apply_realtime_connected(
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

pub(super) fn snapshot_matches_session(
    snapshot: &AuthenticatedRuntimePhaseSnapshot,
    session: &AuthenticatedRuntimeSession,
    auth_scope_generation: u64,
) -> bool {
    snapshot.auth_scope_generation == auth_scope_generation
        && snapshot.user_id == session.user_id
        && snapshot.endpoint == session.endpoint
        && snapshot.websocket == session.websocket
}
