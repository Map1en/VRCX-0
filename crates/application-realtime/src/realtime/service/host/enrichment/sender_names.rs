use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::realtime::{UserQueryCachePolicy, UserQueryKind, UserQueryOptions};

use super::super::{
    RealtimeHostRuntime, RealtimeNotificationProjection, RealtimePersistenceBatch, Value,
};
use super::{is_meaningful_actor_name, meaningful_sender_name, object_string, sender_user_id};

const NOTIFICATION_USERNAME_RESOLVE_ATTEMPTS: usize = 3;
const NOTIFICATION_USERNAME_RESOLVE_RETRY_DELAY: Duration = Duration::from_millis(100);

impl RealtimeHostRuntime {
    pub(in super::super) fn enrich_notification_sender_names(
        &self,
        projection: &mut RealtimeNotificationProjection,
    ) {
        let endpoint = self.active_endpoint();
        for upsert in &mut projection.upserts {
            self.enrich_sender_name(&endpoint, &mut upsert.notification);
        }
    }

    pub(in super::super) fn enrich_persistence_sender_names(
        &self,
        persistence: &mut RealtimePersistenceBatch,
    ) {
        let endpoint = self.active_endpoint();
        for notification in &mut persistence.notification_v1_upserts {
            self.enrich_sender_name(&endpoint, notification);
        }
        for notification in &mut persistence.notification_v2_upserts {
            self.enrich_sender_name(&endpoint, notification);
        }
        for update in &mut persistence.notification_v2_updates {
            self.enrich_sender_name(&endpoint, &mut update.updates);
        }
    }

    fn enrich_sender_name(&self, endpoint: &str, value: &mut Value) -> bool {
        if let Some(name) = meaningful_sender_name(value) {
            apply_sender_display_name(value, &name);
            return true;
        }
        let sender_id = sender_user_id(value);
        if !sender_id.starts_with("usr_") {
            return false;
        }
        let Some(display_name) = self.cached_user_display_name(endpoint, &sender_id) else {
            return false;
        };
        apply_sender_display_name(value, &display_name);
        true
    }

    fn cached_user_display_name(&self, endpoint: &str, user_id: &str) -> Option<String> {
        if let Some(display_name) =
            self.cached_friend_record(endpoint, user_id)
                .and_then(|record| {
                    let display_name = record.display_name.trim();
                    is_meaningful_actor_name(display_name).then(|| display_name.to_string())
                })
        {
            return Some(display_name);
        }
        let user = self.user_facts.get_user(endpoint, user_id)?;
        user_display_name(&Value::Object(user))
    }

    pub(super) async fn resolve_notification_sender_name(
        self: &Arc<Self>,
        endpoint: &str,
        value: &mut Value,
        deadline: Instant,
    ) {
        if self.enrich_sender_name(endpoint, value) {
            return;
        }
        let sender_id = sender_user_id(value);
        if !sender_id.starts_with("usr_") {
            return;
        }
        let Some(display_name) = self
            .fetch_user_display_name_with_retries(endpoint, &sender_id, deadline)
            .await
        else {
            return;
        };
        apply_sender_display_name(value, &display_name);
    }

    async fn fetch_user_display_name_with_retries(
        self: &Arc<Self>,
        endpoint: &str,
        user_id: &str,
        deadline: Instant,
    ) -> Option<String> {
        for attempt in 0..NOTIFICATION_USERNAME_RESOLVE_ATTEMPTS {
            if let Some(user) = self.user_facts.get_user(endpoint, user_id) {
                if let Some(value) = user_display_name(&Value::Object(user)) {
                    return Some(value);
                }
            }
            let remaining = deadline.checked_duration_since(Instant::now())?;
            let response = tokio::time::timeout(
                remaining,
                self.get_user_via_cache_with_options(
                    endpoint.to_string(),
                    user_id.to_string(),
                    UserQueryOptions {
                        kind: UserQueryKind::LiveNonFriend,
                        cache_policy: UserQueryCachePolicy::UseCache,
                    },
                ),
            )
            .await;
            match response {
                Ok(Ok(response)) if (200..300).contains(&response.status) => {
                    let profile = serde_json::from_str::<Value>(&response.data).ok()?;
                    return user_display_name(&profile);
                }
                Ok(Ok(response)) if (500..600).contains(&response.status) => {}
                Ok(Err(_)) => {}
                Ok(Ok(_)) | Err(_) => return None,
            }
            if attempt + 1 < NOTIFICATION_USERNAME_RESOLVE_ATTEMPTS {
                sleep_before_retry(deadline).await;
            }
        }
        None
    }
}

async fn sleep_before_retry(deadline: Instant) {
    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
        return;
    };
    let delay = NOTIFICATION_USERNAME_RESOLVE_RETRY_DELAY.min(remaining);
    if delay > Duration::ZERO {
        tokio::time::sleep(delay).await;
    }
}

fn user_display_name(value: &Value) -> Option<String> {
    let display_name = value
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    is_meaningful_actor_name(display_name).then(|| display_name.to_string())
}

fn apply_sender_display_name(value: &mut Value, display_name: &str) {
    let display_name = display_name.trim();
    if !is_meaningful_actor_name(display_name) {
        return;
    }
    let Some(object) = value.as_object_mut() else {
        return;
    };
    object.insert(
        "senderDisplayName".into(),
        Value::String(display_name.to_string()),
    );
    let sender_username = object_string(object, "senderUsername");
    if !is_meaningful_actor_name(&sender_username) {
        object.insert(
            "senderUsername".into(),
            Value::String(display_name.to_string()),
        );
    }
}
