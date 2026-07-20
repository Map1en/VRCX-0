use super::state::RealtimeHostRuntimeMessageSink;
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
        if status == "connected" {
            if let Some(activity_sink) = &self.runtime.deps.activity_sink {
                activity_sink.set_delivery_armed(true);
            }
            if let Some(transport) =
                self.runtime
                    .current_transport(generation, session_generation, session)
            {
                let _ = self
                    .runtime
                    .transport_lifecycle_tx
                    .send(RealtimeTransportLifecycleEvent::Connected(transport));
            }
        }
    }

    fn handle_realtime_ws_message(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        payload: &RealtimeWsMessagePayload,
    ) {
        let state = match self.runtime.state.lock() {
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
            drop(state);
            self.runtime
                .handle_friend_ws_message(generation, session_generation, session, payload);
        } else {
            drop(state);
        }

        if let Some(output) =
            apply_notification_ws_message(&session.user_id, &session.endpoint, generation, payload)
        {
            self.runtime.schedule_notification_output(
                generation,
                session_generation,
                session.clone(),
                output,
            );
            return;
        }

        if crate::is_print_created_content_refresh(payload) {
            self.runtime
                .deps
                .print_cleanup
                .schedule_print_cleanup(PrintCleanupTrigger {
                    user_id: session.user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    reason: "content-refresh".to_string(),
                });
        }

        if let Some(mut projection) = apply_instance_queue_ws_message(generation, payload) {
            self.runtime
                .enrich_instance_queue_projection(&mut projection);
            if let Some(activity_sink) = &self.runtime.deps.activity_sink {
                activity_sink.ingest_instance_queue_projection(&projection);
            }
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
}
