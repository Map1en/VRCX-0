use serde_json::Value;

use super::types::{SavedCredentialUser, SavedLoginParams};

pub(super) fn value_as_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn value_as_raw_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

pub(super) fn object_field_string(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(|value| value_as_string(Some(value)))
        .unwrap_or_default()
}

pub(super) fn object_field_raw_string(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(|value| value_as_raw_string(Some(value)))
        .unwrap_or_default()
}

fn optional_raw_string(value: &Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
}

pub(super) fn saved_credential_user_from_value(
    value: &Value,
    fallback_user_id: &str,
) -> Option<SavedCredentialUser> {
    value.as_object()?;
    let id = object_field_string(value, "id");
    let id = if id.is_empty() {
        fallback_user_id.trim().to_string()
    } else {
        id
    };
    if id.is_empty() {
        return None;
    }

    Some(SavedCredentialUser {
        id,
        display_name: optional_raw_string(value, "displayName"),
        username: optional_raw_string(value, "username"),
        user_icon: optional_raw_string(value, "userIcon"),
        profile_pic_override_thumbnail: optional_raw_string(value, "profilePicOverrideThumbnail"),
        profile_pic_override: optional_raw_string(value, "profilePicOverride"),
        thumbnail_url: optional_raw_string(value, "thumbnailUrl"),
        current_avatar_thumbnail_image_url: optional_raw_string(
            value,
            "currentAvatarThumbnailImageUrl",
        ),
        current_avatar_image_url: optional_raw_string(value, "currentAvatarImageUrl"),
    })
}

pub(super) fn saved_login_params_from_value(value: &Value) -> SavedLoginParams {
    SavedLoginParams {
        username: object_field_raw_string(value, "username"),
        password: Some(object_field_raw_string(value, "password")),
        endpoint: String::new(),
        websocket: String::new(),
    }
}

pub(super) fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}
