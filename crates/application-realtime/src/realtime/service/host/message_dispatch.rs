use vrcx_0_application_core::PrintCleanupTrigger;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

use crate::realtime::activity_events::queue_ready_activity_event;
use crate::realtime::connection::RealtimeMessageSink;
use crate::realtime::event_kind::RealtimeWsEventKind;
use crate::realtime::group_changes::group_change_event;
use crate::realtime::instance_queue::apply_instance_queue_ws_event;
use crate::realtime::notifications::{apply_instance_closed_ws_event, apply_notification_ws_event};
use crate::realtime::print_content_refresh::is_print_created_content_refresh_event;
use crate::realtime::{
    RealtimeInstanceQueueKind, RealtimeSessionContext, RealtimeTransportLifecycleEvent,
    RealtimeWsStatus,
};

use super::state::RealtimeHostRuntimeMessageSink;

pub(super) use vrcx_0_core::json::trimmed_text_of as json_string_field;
use vrcx_0_core::OwnerId;

impl RealtimeMessageSink for RealtimeHostRuntimeMessageSink {
    fn handle_realtime_transport_status(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        status: RealtimeWsStatus,
    ) {
        if status == RealtimeWsStatus::Connected {
            if let Some(activity) = &self.runtime.deps.activity {
                activity.arm_delivery();
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

        let Some(event_kind) = RealtimeWsEventKind::from_payload(payload) else {
            drop(state);
            return;
        };
        if event_kind.is_friend() {
            drop(state);
            self.runtime.handle_friend_ws_event(
                generation,
                session_generation,
                session,
                &event_kind,
                payload,
            );
            return;
        } else {
            drop(state);
        }

        if let Some(output) = apply_notification_ws_event(
            &OwnerId::new(session.user_id.clone()),
            &session.endpoint,
            generation,
            &event_kind,
            payload,
        ) {
            self.runtime.schedule_notification_output(
                generation,
                session_generation,
                session.clone(),
                output,
            );
            return;
        }

        if let Some(event) = group_change_event(&session.user_id, &event_kind, payload) {
            self.runtime.schedule_group_change(
                generation,
                session_generation,
                session.clone(),
                event,
            );
            return;
        }

        if is_print_created_content_refresh_event(&event_kind, payload) {
            self.runtime
                .deps
                .print_cleanup
                .schedule_print_cleanup(PrintCleanupTrigger {
                    user_id: session.user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    reason: "content-refresh".to_string(),
                });
            return;
        }

        if event_kind == RealtimeWsEventKind::EconomyUpdate {
            if let Some(wallet_balance) = payload
                .json
                .get("content")
                .and_then(|content| content.get("walletBalance"))
                .and_then(serde_json::Value::as_i64)
            {
                self.runtime.deps.event_bus.emit(
                    vrcx_0_application_core::RealtimeEconomyBalancePayload {
                        user_id: session.user_id.clone(),
                        wallet_balance,
                    },
                );
            }
            return;
        }

        if let Some(mut projection) =
            apply_instance_queue_ws_event(generation, &event_kind, payload)
        {
            self.runtime
                .enrich_instance_queue_projection(&mut projection);
            if let (Some(activity), RealtimeInstanceQueueKind::Ready) =
                (&self.runtime.deps.activity, projection.kind)
            {
                activity.ingest_activity(vec![queue_ready_activity_event(&projection)]);
            }
            self.runtime.deps.event_bus.emit(projection);
            return;
        }

        let is_user_update = event_kind == RealtimeWsEventKind::UserUpdate;
        if let Some(output) = self.runtime.current_user.apply_ws_event(
            generation,
            &event_kind,
            payload,
            self.runtime.local_game_context(),
        ) {
            let overlay_patch = output.projection.patch.clone();
            let wake_at_ms = output.wake_at_ms;
            self.runtime.apply_current_user_output(output);
            if let Some(at_ms) = wake_at_ms {
                self.runtime.schedule_current_user_wake(generation, at_ms);
            }
            if is_user_update {
                self.runtime.refresh_current_user_snapshot_after_update(
                    generation,
                    overlay_patch.into_map(),
                );
            }
            return;
        }

        if let Some(output) = apply_instance_closed_ws_event(generation, &event_kind, payload) {
            self.runtime
                .apply_instance_closed_output(&OwnerId::new(session.user_id.clone()), output);
        }
    }
}
