use serde_json::{Map, Value};
use vrcx_0_application_core::FriendProjectionPatch;
use vrcx_0_core::friends::FriendRecord;

use super::super::utils::parse_location;

pub(super) struct ProjectedFriendRecord {
    pub(super) record: FriendRecord,
    pub(super) patch: FriendProjectionPatch,
    pub(super) was_traveling: bool,
}

pub(super) fn project_friend_record(
    previous: Option<&FriendRecord>,
    user_id: &str,
    patch: Value,
    state_bucket: &str,
    state_bucket_authority: &str,
) -> ProjectedFriendRecord {
    let mut record = previous.cloned().unwrap_or_default();
    let was_traveling = parse_location(&record.location).is_traveling;
    if let Some(patch_object) = patch.as_object() {
        apply_value_patch_to_record(&mut record, patch_object);
    }
    record.id = user_id.to_string();
    record.state = state_bucket.to_string();
    record.state_bucket = state_bucket.to_string();
    sanitize_record_extra(&mut record);

    ProjectedFriendRecord {
        patch: FriendProjectionPatch {
            user_id: user_id.to_string(),
            patch: record_to_value(&record),
            state_bucket: state_bucket.to_string(),
            state_bucket_authority: Some(state_bucket_authority.to_string()),
        },
        record,
        was_traveling,
    }
}

const FRIEND_NAMED_FIELD_KEYS: &[&str] = &[
    "id",
    "displayName",
    "username",
    "state",
    "stateBucket",
    "location",
    "travelingToLocation",
    "worldId",
    "platform",
    "lastPlatform",
    "last_platform",
    "status",
    "statusDescription",
    "bio",
    "currentAvatarImageUrl",
    "currentAvatarThumbnailImageUrl",
    "currentAvatarAuthorId",
    "currentAvatarName",
];

fn is_named_field_key(key: &str) -> bool {
    FRIEND_NAMED_FIELD_KEYS.contains(&key)
}

fn patch_str(patch: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        match patch.get(*key) {
            Some(Value::String(value)) => return Some(value.clone()),
            Some(Value::Null) | None => {}
            Some(other) => {
                tracing::warn!(
                    "friend patch field `{}` has non-string value: {}",
                    *key,
                    other
                );
            }
        }
    }
    None
}

pub(super) fn apply_value_patch_to_record(record: &mut FriendRecord, patch: &Map<String, Value>) {
    if let Some(value) = patch_str(patch, &["displayName"]) {
        record.display_name = value;
    }
    if let Some(value) = patch_str(patch, &["username"]) {
        record.username = value;
    }
    if let Some(value) = patch_str(patch, &["location"]) {
        record.location = value;
    }
    if let Some(value) = patch_str(patch, &["travelingToLocation"]) {
        record.traveling_to_location = value;
    }
    if let Some(value) = patch_str(patch, &["worldId"]) {
        record.world_id = value;
    }
    if let Some(value) = patch_str(patch, &["platform"]) {
        record.platform = value;
    }
    if let Some(value) = patch_str(patch, &["lastPlatform", "last_platform"]) {
        record.last_platform = value;
    }
    if let Some(value) = patch_str(patch, &["status"]) {
        record.status = value;
    }
    if let Some(value) = patch_str(patch, &["statusDescription"]) {
        record.status_description = value;
    }
    if let Some(value) = patch_str(patch, &["bio"]) {
        record.bio = value;
    }
    if let Some(value) = patch_str(patch, &["currentAvatarImageUrl"]) {
        record.current_avatar_image_url = value;
    }
    if let Some(value) = patch_str(patch, &["currentAvatarThumbnailImageUrl"]) {
        record.current_avatar_thumbnail_image_url = value;
    }
    if let Some(value) = patch_str(patch, &["currentAvatarAuthorId"]) {
        record.current_avatar_author_id = value;
    }
    if let Some(value) = patch_str(patch, &["currentAvatarName"]) {
        record.current_avatar_name = value;
    }
    for (key, value) in patch {
        if is_named_field_key(key) {
            continue;
        }
        record.extra.insert(key.clone(), value.clone());
    }
}

pub(super) fn sanitize_record_extra(record: &mut FriendRecord) {
    for key in FRIEND_NAMED_FIELD_KEYS {
        record.extra.remove(*key);
    }
}

pub(in crate::realtime::friends::runtime) fn record_to_value(record: &FriendRecord) -> Value {
    serde_json::to_value(record).unwrap_or(Value::Null)
}
