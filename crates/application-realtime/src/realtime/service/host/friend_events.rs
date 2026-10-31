use std::sync::Arc;

use vrcx_0_core::realtime::RealtimeWsMessagePayload;

use crate::realtime::event_kind::RealtimeWsEventKind;
use crate::realtime::{
    FriendProjection, FriendWake, RealtimeFriendApplyResult, RealtimeSessionContext,
};

use super::state::RealtimeHostRuntimeState;
use super::{sleep_until, RealtimeHostRuntime};

impl RealtimeHostRuntime {
    fn is_friend_output_current_locked(
        &self,
        state: &RealtimeHostRuntimeState,
        projection: &FriendProjection,
    ) -> bool {
        let Some(active) = state.connection.active_context.as_ref() else {
            return false;
        };
        active.generation == projection.generation && self.is_session_live(active)
    }

    pub(super) fn is_message_current_locked(
        &self,
        state: &RealtimeHostRuntimeState,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) -> bool {
        state
            .connection
            .active_context
            .as_ref()
            .map(|active| {
                active.generation == generation
                    && active.session_generation == session_generation
                    && active.session == *session
                    && self
                        .deps
                        .session
                        .is_realtime_generation_active(session_generation)
            })
            .unwrap_or(false)
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub(super) fn handle_friend_ws_message(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        payload: &RealtimeWsMessagePayload,
    ) {
        let Some(event_kind) = RealtimeWsEventKind::from_payload(payload) else {
            return;
        };
        self.handle_friend_ws_event(
            generation,
            session_generation,
            session,
            &event_kind,
            payload,
        );
    }

    pub(super) fn handle_friend_ws_event(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        event_kind: &RealtimeWsEventKind,
        payload: &RealtimeWsMessagePayload,
    ) {
        let owner = self.lock_friend_owner();
        let state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        if !self.is_message_current_locked(&state, generation, session_generation, session) {
            return;
        }
        drop(state);

        match self.friends.apply_ws_event(event_kind, payload) {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output_owned(&owner, *output);
            }
            RealtimeFriendApplyResult::MissingBaseline => {
                tracing::warn!(
                    generation,
                    "[Realtime] friend event arrived without a baseline"
                );
            }
            RealtimeFriendApplyResult::Ignored => {}
        };
    }

    pub(super) fn is_friend_projection_current(&self, projection: &FriendProjection) -> bool {
        let state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return false;
            }
        };
        self.is_friend_output_current_locked(&state, projection)
    }

    pub(super) fn schedule_friend_wake(self: &Arc<Self>, generation: u64, wake: FriendWake) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            sleep_until(wake.at_ms).await;
            runtime.wake_friend(generation, &wake.user_id);
        });
    }

    pub(super) fn wake_friend(self: &Arc<Self>, generation: u64, user_id: &str) {
        let owner = self.lock_friend_owner();
        let current = match self.state.lock() {
            Ok(state) => state
                .connection
                .active_context
                .as_ref()
                .is_some_and(|active| active.generation == generation),
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                false
            }
        };
        if !current {
            return;
        }
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(output) = self.friends.wake(user_id, &now) {
            self.apply_friend_output_owned(&owner, output);
        }
    }
}
