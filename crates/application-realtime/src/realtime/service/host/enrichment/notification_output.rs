use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::super::{
    RealtimeHostRuntime, RealtimeNotificationOutput, RealtimeNotificationProjection,
    RealtimeNotificationUpsert, RealtimePersistenceBatch, Value,
};
use super::{
    is_meaningful_actor_name, is_person_notification_type, meaningful_sender_name, object_string,
};

const NOTIFICATION_USERNAME_RESOLVE_BUDGET: Duration = Duration::from_secs(2);

impl RealtimeHostRuntime {
    pub(in super::super) fn finalize_notification_output_for_delivery(
        &self,
        output: &mut RealtimeNotificationOutput,
    ) {
        self.sync_persistence_notifications_from_projection(output);
        self.sanitize_persistence_notification_names(&mut output.persistence);
        self.sanitize_projection_notification_names(&mut output.projection);
        for upsert in &mut output.projection.upserts {
            if upsert.insert_defaults.is_some() {
                continue;
            }
            if !notification_is_deliverable(&upsert.notification) {
                upsert.notify_menu = false;
                upsert.deliver_runtime = false;
                upsert.run_automation = false;
            }
        }
    }

    pub(in super::super) async fn resolve_notification_output_names(
        self: &Arc<Self>,
        output: &mut RealtimeNotificationOutput,
    ) {
        let endpoint = self.active_endpoint();
        if endpoint.is_empty() {
            return;
        }
        let deadline = Instant::now() + NOTIFICATION_USERNAME_RESOLVE_BUDGET;
        for upsert in &mut output.projection.upserts {
            if !notification_upsert_needs_remote_resolution(upsert) {
                continue;
            }
            self.resolve_notification_sender_name(&endpoint, &mut upsert.notification, deadline)
                .await;
        }
        self.sync_persistence_notifications_from_projection(output);
    }

    fn sync_persistence_notifications_from_projection(
        &self,
        output: &mut RealtimeNotificationOutput,
    ) {
        let mut by_id = HashMap::new();
        for upsert in &output.projection.upserts {
            let id = notification_id(&upsert.notification);
            if !id.is_empty() {
                by_id.insert(id, upsert.notification.clone());
            }
        }
        for notification in &mut output.persistence.notification_v1_upserts {
            if let Some(resolved) = by_id.get(&notification_id(notification)) {
                *notification = resolved.as_value().clone();
            }
        }
        for notification in &mut output.persistence.notification_v2_upserts {
            if let Some(resolved) = by_id.get(&notification_id(notification)) {
                *notification = resolved.as_value().clone();
            }
        }
    }

    fn sanitize_projection_notification_names(
        &self,
        projection: &mut RealtimeNotificationProjection,
    ) {
        for upsert in &mut projection.upserts {
            sanitize_notification_display_names(&mut upsert.notification);
        }
    }

    fn sanitize_persistence_notification_names(&self, persistence: &mut RealtimePersistenceBatch) {
        for notification in &mut persistence.notification_v1_upserts {
            sanitize_notification_display_names(notification);
        }
        for notification in &mut persistence.notification_v2_upserts {
            sanitize_notification_display_names(notification);
        }
        for update in &mut persistence.notification_v2_updates {
            sanitize_notification_display_names(&mut update.updates);
        }
    }

    pub(in super::super) fn projection_has_visible_notification_work(
        &self,
        projection: &RealtimeNotificationProjection,
    ) -> bool {
        projection
            .upserts
            .iter()
            .any(notification_upsert_is_visible)
            || !projection.expired_ids.is_empty()
            || !projection.seen_ids.is_empty()
            || projection.clear_menu_if_no_unseen
    }

    pub(in super::super) fn visible_notification_projection(
        &self,
        mut projection: RealtimeNotificationProjection,
    ) -> RealtimeNotificationProjection {
        projection.upserts.retain(notification_upsert_is_visible);
        projection
    }

    pub(in super::super) fn notification_output_needs_remote_resolution(
        &self,
        output: &RealtimeNotificationOutput,
    ) -> bool {
        output
            .projection
            .upserts
            .iter()
            .any(notification_upsert_needs_remote_resolution)
    }
}

fn notification_upsert_needs_remote_resolution(upsert: &RealtimeNotificationUpsert) -> bool {
    if upsert.insert_defaults.is_some() || !notification_upsert_is_visible(upsert) {
        return false;
    }
    notification_has_unresolved_required_display(&upsert.notification)
}

fn notification_upsert_is_visible(upsert: &RealtimeNotificationUpsert) -> bool {
    upsert.notify_menu
        || upsert.deliver_runtime
        || upsert.run_automation
        || upsert.insert_defaults.is_some()
}

fn notification_is_deliverable(value: &Value) -> bool {
    !notification_has_unresolved_required_display(value)
}

fn notification_has_unresolved_required_display(value: &Value) -> bool {
    notification_requires_sender_name(value) && meaningful_sender_name(value).is_none()
}

fn notification_requires_sender_name(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object_string(object, "senderUserId").starts_with("grp_") {
        return false;
    }
    is_person_notification_type(&object_string(object, "type"))
}

fn sanitize_notification_display_names(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for key in ["senderDisplayName", "displayName", "senderUsername"] {
        let current = object_string(object, key);
        if !current.is_empty() && !is_meaningful_actor_name(&current) {
            object.insert(key.into(), Value::String(String::new()));
        }
    }

    sanitize_world_name_fields(object);
    if let Some(details) = object.get_mut("details").and_then(Value::as_object_mut) {
        sanitize_world_name_fields(details);
    }
}

fn notification_id(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let id = object_string(object, "id");
    if id.is_empty() {
        object_string(object, "notificationId")
    } else {
        id
    }
}

fn sanitize_world_name_fields(object: &mut serde_json::Map<String, Value>) {
    let world_name = object_string(object, "worldName");
    let world_id = vrcx_0_core::location::world_id_from_location(&world_name);
    if world_id.is_empty() {
        return;
    }
    if object_string(object, "worldId").is_empty() {
        object.insert("worldId".into(), Value::String(world_id));
    }
    object.insert("worldName".into(), Value::String(String::new()));
}
