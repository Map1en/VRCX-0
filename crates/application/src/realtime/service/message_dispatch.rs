use super::types::RealtimeHostRuntimeMessageSink;
use super::*;

pub(super) fn json_string_field(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            value
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
        .trim()
        .to_string()
}

impl RealtimeMessageSink for RealtimeHostRuntimeMessageSink {
    fn handle_realtime_transport_status(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        status: &str,
    ) {
        if status != "reconnecting" {
            return;
        }
        let mut state = match self.runtime.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        if !self
            .runtime
            .is_message_current_locked(&state, generation, session_generation, session)
        {
            return;
        }
        state.friend_messages_paused = true;
        state.queued_friend_messages.clear();
    }

    fn handle_realtime_ws_message(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        payload: &RealtimeWsMessagePayload,
    ) {
        let mut state = match self.runtime.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        if !self
            .runtime
            .is_message_current_locked(&state, generation, session_generation, session)
        {
            return;
        }

        let message_type = payload.json.get("type").and_then(serde_json::Value::as_str);
        if message_type.map(is_friend_event_type).unwrap_or(false) {
            if state.friend_messages_paused {
                self.runtime
                    .queue_friend_message_locked(&mut state, generation, payload);
                return;
            }
            drop(state);
            self.runtime
                .handle_friend_ws_message(generation, session_generation, session, payload);
        } else {
            drop(state);
        }

        if let Some(output) =
            apply_notification_ws_message(&session.user_id, &session.endpoint, generation, payload)
        {
            self.runtime.apply_notification_output(output);
            return;
        }

        if let Some(projection) = apply_instance_queue_ws_message(generation, payload) {
            self.runtime
                .deps
                .overlay_activity
                .ingest_instance_queue_projection(&projection);
            self.runtime
                .deps
                .event_bus
                .emit_realtime_instance_queue_projection(projection);
            return;
        }

        let is_user_update = message_type == Some("user-update");
        if let Some(output) = self.runtime.current_user.apply_ws_message(
            generation,
            payload,
            self.runtime.current_user_authority(),
        ) {
            let overlay_patch = output.projection.patch.clone();
            self.runtime.apply_current_user_output(output);
            if is_user_update {
                self.runtime.refresh_current_user_snapshot_after_update(
                    generation,
                    session.clone(),
                    overlay_patch,
                );
            }
            return;
        }

        if let Some(output) = apply_instance_closed_ws_message(generation, payload) {
            self.runtime
                .apply_instance_closed_output(&session.user_id, output);
        }
    }

    fn handle_realtime_transport_finished(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) {
        let final_current_user_output = {
            let mut state = match self.runtime.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            let Some(active) = state.active_context.as_ref() else {
                return;
            };
            if active.generation != generation
                || active.session_generation != session_generation
                || active.session != *session
            {
                return;
            }
            let final_current_user_output = self
                .runtime
                .current_user
                .apply_game_running_state(generation, false);
            state.active_context = None;
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
            state.friend_profile_refetches.clear();
            self.runtime.friends.clear();
            self.runtime.current_user.clear();
            final_current_user_output
        };

        if let Some(output) = final_current_user_output {
            self.runtime.apply_current_user_output(output);
        }
    }
}
