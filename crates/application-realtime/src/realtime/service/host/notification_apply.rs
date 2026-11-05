use std::sync::Arc;

use super::RealtimeHostRuntime;
use crate::realtime::group_changes::{group_change_notification, GroupChangeEvent};
use crate::realtime::{RealtimeNotificationOutput, RealtimeSessionContext};

#[derive(Default)]
pub(super) struct NotificationApplyLane {
    lock: tokio::sync::Mutex<()>,
}

impl RealtimeHostRuntime {
    pub(super) fn schedule_notification_output(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: RealtimeSessionContext,
        output: RealtimeNotificationOutput,
    ) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            let _guard = runtime.notification_apply.lock.lock().await;
            if !runtime.is_notification_context_current(generation, session_generation, &session) {
                return;
            }
            let mut output = output;
            if runtime.notification_output_needs_remote_resolution(&output) {
                runtime.resolve_notification_output_names(&mut output).await;
                if !runtime.is_notification_context_current(
                    generation,
                    session_generation,
                    &session,
                ) {
                    return;
                }
            }
            runtime.apply_notification_output(output);
        });
    }

    pub(super) fn schedule_group_change(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: RealtimeSessionContext,
        event: GroupChangeEvent,
    ) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            let group = runtime
                .fetch_group(&session.endpoint, &event.group_id)
                .await;
            let _guard = runtime.notification_apply.lock.lock().await;
            if !runtime.is_notification_context_current(generation, session_generation, &session) {
                return;
            }
            runtime.apply_app_notification(
                generation,
                &session,
                group_change_notification(&event, &group),
            );
        });
    }
}
