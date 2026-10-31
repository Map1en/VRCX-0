use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use vrcx_0_contracts::notifications::AppNotification;
use vrcx_0_contracts::realtime::RealtimePersistenceBatch;
use vrcx_0_contracts::vrchat_api::VrchatScope as ApiScope;
use vrcx_0_core::OwnerId;

use super::RealtimeHostRuntime;
use crate::realtime::group_changes::{group_change_notification, GroupChangeEvent};
use crate::realtime::{
    RealtimeNotificationOutput, RealtimeNotificationProjection, RealtimeNotificationUpsert,
    RealtimeSessionContext,
};

const GROUP_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

impl RealtimeHostRuntime {
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
            let _guard = runtime.notification_apply_lock.lock().await;
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

    pub(super) fn apply_app_notification(
        self: &Arc<Self>,
        generation: u64,
        session: &RealtimeSessionContext,
        notification: AppNotification,
    ) {
        let projected = serde_json::to_value(notification.list_item()).unwrap_or(Value::Null);
        self.apply_notification_output(RealtimeNotificationOutput {
            owner_user_id: OwnerId::new(session.user_id.clone()),
            projection: RealtimeNotificationProjection {
                generation,
                upserts: vec![RealtimeNotificationUpsert {
                    notification: projected.into(),
                    insert_defaults: None,
                    notify_menu: false,
                    deliver_runtime: true,
                    run_automation: false,
                }],
                ..RealtimeNotificationProjection::default()
            },
            persistence: RealtimePersistenceBatch {
                app_notification_upserts: vec![notification],
                ..RealtimePersistenceBatch::default()
            },
        });
    }

    async fn fetch_group(&self, endpoint: &str, group_id: &str) -> Value {
        let Ok(request) = self
            .deps
            .remote_requests
            .group(endpoint.to_string(), group_id.to_string())
        else {
            return Value::Null;
        };
        match tokio::time::timeout(
            GROUP_FETCH_TIMEOUT,
            self.deps.web.execute_api(request, ApiScope::Vrchat),
        )
        .await
        {
            Ok(Ok(response)) if (200..300).contains(&response.status) => {
                serde_json::from_str(&response.data).unwrap_or(Value::Null)
            }
            _ => Value::Null,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::test_support::*;
    use crate::realtime::group_changes::GroupChange;
    use vrcx_0_contracts::notifications::NotificationListQueryInput;

    use super::*;

    #[test]
    fn app_notification_lands_in_its_table_and_the_projection(
    ) -> vrcx_0_application_core::Result<()> {
        let (_dir, runtime, session) = runtime_with_active_session("group-change")?;
        runtime.runtime().deps.event_bus.take_events_for_test();

        runtime.runtime().apply_app_notification(
            7,
            &session,
            group_change_notification(
                &GroupChangeEvent {
                    group_id: "grp_1".into(),
                    change: GroupChange::Left,
                    received_at: "2026-10-30T00:00:00.000Z".into(),
                },
                &json!({ "name": "Club", "iconUrl": "https://example.test/icon.png" }),
            ),
        );

        let events = runtime.runtime().deps.event_bus.take_events_for_test();
        let projection = events
            .iter()
            .find(|event| event.name == "realtimeNotificationProjection")
            .expect("group change should emit a notification projection");
        let projected = &projection.payload["upserts"][0]["notification"];
        assert_eq!(projected["type"], "groupChange");
        assert_eq!(projected["senderUsername"], "Club");
        assert_eq!(
            projected["details"]["messageKey"],
            "notifications.group_left"
        );

        let rows = notification_list_query(
            runtime.database(),
            NotificationListQueryInput {
                user_id: session.user_id.clone(),
                search: String::new(),
                filters: Vec::new(),
                per_table_limit: 10,
                limit: 10,
                include_unseen: false,
            },
        )?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sender_user_id, "grp_1");
        assert_eq!(rows[0].details["messageKey"], "notifications.group_left");
        Ok(())
    }
}
