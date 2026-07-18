use super::state::{ActiveRealtimeContext, RealtimeHostRuntimeState, MAX_QUEUED_FRIEND_MESSAGES};
use super::*;

impl RealtimeHostRuntime {
    fn is_friend_output_current_locked(
        &self,
        state: &RealtimeHostRuntimeState,
        projection: &FriendProjection,
    ) -> bool {
        let Some(active) = state.connection.active_context.as_ref() else {
            return false;
        };
        active.generation == projection.generation
            && self
                .deps
                .session
                .is_realtime_generation_active(active.session_generation)
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

    pub(super) fn queue_friend_message_locked(
        &self,
        state: &mut RealtimeHostRuntimeState,
        generation: u64,
        payload: &RealtimeWsMessagePayload,
    ) {
        if state.connection.queued_friend_messages.len() >= MAX_QUEUED_FRIEND_MESSAGES {
            state.connection.queued_friend_messages.remove(0);
            tracing::warn!(
                generation,
                max = MAX_QUEUED_FRIEND_MESSAGES,
                "[Realtime] dropped oldest queued friend message during baseline refresh"
            );
        }
        state
            .connection
            .queued_friend_messages
            .push(payload.clone());
    }

    pub(super) fn handle_friend_ws_message(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
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

        match self.friends.apply_ws_message(payload) {
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

    pub(super) fn fire_pending_offline(self: &Arc<Self>, user_id: &str, token: u64, now: String) {
        let owner = self.lock_friend_owner();
        if let Some(output) = self.friends.fire_pending_offline(user_id, token, now) {
            self.apply_friend_output_owned(&owner, output);
        }
    }

    pub(super) fn drain_queued_friend_messages(self: &Arc<Self>, active: ActiveRealtimeContext) {
        loop {
            let queued_messages = {
                let mut state = match self.state.lock() {
                    Ok(state) => state,
                    Err(error) => {
                        tracing::warn!("realtime state lock failed: {error}");
                        return;
                    }
                };
                if !self.is_message_current_locked(
                    &state,
                    active.generation,
                    active.session_generation,
                    &active.session,
                ) {
                    return;
                }
                if state.connection.queued_friend_messages.is_empty() {
                    state.connection.friend_messages_paused = false;
                    return;
                }
                std::mem::take(&mut state.connection.queued_friend_messages)
            };

            for payload in queued_messages {
                self.handle_friend_ws_message(
                    active.generation,
                    active.session_generation,
                    &active.session,
                    &payload,
                );
            }
        }
    }

    pub(super) fn resume_friend_messages_after_reconnect(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) {
        let active = {
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
            if !state.connection.friend_messages_paused {
                return;
            }
            let Some(active) = state.connection.active_context.clone() else {
                return;
            };
            active
        };
        self.drain_queued_friend_messages(active);
    }
}
