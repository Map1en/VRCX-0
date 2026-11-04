use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::OwnerId;

use super::super::{RealtimeHostRuntime, RealtimeNotificationProjection, Value};
use super::{is_person_notification_type, nested_object_string, object_string, sender_user_id};

impl RealtimeHostRuntime {
    pub(in super::super) fn enrich_notification_images(
        &self,
        projection: &mut RealtimeNotificationProjection,
        owner_user_id: &OwnerId,
    ) {
        let endpoint = self.active_endpoint();
        if endpoint.is_empty() {
            return;
        }
        for upsert in &mut projection.upserts {
            self.enrich_notification_image(&endpoint, &mut upsert.notification, owner_user_id);
        }
    }

    fn cached_user_image_url(&self, endpoint: &str, user_id: &str) -> Option<String> {
        if let Some(url) = self.cached_friend_image_url(endpoint, user_id) {
            return Some(url);
        }
        let user = self.user_facts.get_user(endpoint, user_id)?;
        user.trimmed_string("iconUrl")
    }

    fn cached_friend_image_url(&self, endpoint: &str, user_id: &str) -> Option<String> {
        let record = self.cached_friend_record(endpoint, user_id)?;
        let url = record.icon_url.trim();
        (!url.is_empty()).then(|| url.to_string())
    }

    pub(super) fn cached_friend_record(
        &self,
        endpoint: &str,
        user_id: &str,
    ) -> Option<FriendRecord> {
        self.friends
            .current_friend_record(user_id)
            .filter(|snapshot| snapshot.endpoint.trim() == endpoint.trim())
            .map(|snapshot| snapshot.record)
    }

    pub fn cached_user_notification_image_url(
        &self,
        endpoint: &str,
        user_id: &str,
    ) -> Option<String> {
        self.cached_user_image_url(endpoint, user_id)
    }

    pub fn cached_friend_notification_image_url(
        &self,
        endpoint: &str,
        user_id: &str,
    ) -> Option<String> {
        self.cached_friend_image_url(endpoint, user_id)
    }

    fn enrich_notification_image(
        &self,
        endpoint: &str,
        value: &mut Value,
        owner_user_id: &OwnerId,
    ) -> bool {
        if notification_has_direct_image(value) {
            return true;
        }
        let Some(user_id) = notification_avatar_user_id(value, owner_user_id) else {
            return false;
        };
        let Some(image_url) = self.cached_user_image_url(endpoint, &user_id) else {
            return false;
        };
        apply_notification_image_url(value, &image_url);
        true
    }
}

fn notification_has_direct_image(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    [
        object_string(object, "thumbnailImageUrl"),
        nested_object_string(object, &["details", "imageUrl"]),
        object_string(object, "imageUrl"),
        object_string(object, "currentAvatarThumbnailImageUrl"),
        object_string(object, "currentAvatarImageUrl"),
        object_string(object, "thumbnailUrl"),
    ]
    .iter()
    .any(|value| !value.trim().is_empty())
}

fn notification_allows_avatar_resolution(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object_string(object, "senderUserId").starts_with("grp_") {
        return false;
    }
    is_person_notification_type(&object_string(object, "type"))
}

fn notification_avatar_user_id(value: &Value, owner_user_id: &OwnerId) -> Option<String> {
    if !notification_allows_avatar_resolution(value) {
        return None;
    }
    let user_id = sender_user_id(value);
    if !user_id.starts_with("usr_") {
        return None;
    }
    let owner_user_id = owner_user_id.as_str().trim();
    if !owner_user_id.is_empty() && user_id == owner_user_id {
        return None;
    }
    Some(user_id)
}

fn apply_notification_image_url(value: &mut Value, image_url: &str) {
    let image_url = image_url.trim();
    if image_url.is_empty() || notification_has_direct_image(value) {
        return;
    }
    let Some(object) = value.as_object_mut() else {
        return;
    };
    object.insert("imageUrl".into(), Value::String(image_url.to_string()));
}
