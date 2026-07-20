use serde_json::{json, Map, Value};
use vrcx_0_core::friends::{normalize_state_bucket, FriendRecord};
use vrcx_0_core::trust::compute_trust_level;

use super::super::persistence::add_location_metadata;
use super::super::utils::{first_owned, first_string, parse_location, string_field, EventTime};

pub(super) fn resolve_state_bucket(
    content: &Value,
    previous: Option<&FriendRecord>,
    trust_event_user_state: bool,
    fallback: &str,
) -> String {
    let user_state = trust_event_user_state
        .then(|| content.get("user").and_then(|user| user.get("state")))
        .flatten();
    if let Some(normalized) = user_state
        .and_then(Value::as_str)
        .and_then(normalize_state_bucket)
    {
        return normalized;
    }
    if let Some(previous) = previous {
        for candidate in [previous.state_bucket.as_str(), previous.state.as_str()] {
            if let Some(normalized) = normalize_state_bucket(candidate) {
                return normalized;
            }
        }
    }
    fallback.to_string()
}

pub(super) fn normalize_patch_trust(patch: &mut Value, previous: Option<&FriendRecord>) {
    let Some(object) = patch.as_object_mut() else {
        return;
    };
    let explicit_trust_level = first_owned([
        string_field(object.get("$trustLevel")),
        string_field(object.get("trustLevel")),
    ]);
    let has_trust_metadata = object.contains_key("tags") || object.contains_key("developerType");
    if explicit_trust_level.is_empty() && !has_trust_metadata {
        return;
    }

    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .or_else(|| previous.and_then(|record| record.extra.get("tags")?.as_array()))
        .map(|values| {
            values
                .iter()
                .map(|value| string_field(Some(value)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let developer_type = object
        .get("developerType")
        .and_then(Value::as_str)
        .or_else(|| previous.and_then(|record| record.extra.get("developerType")?.as_str()))
        .unwrap_or("");
    let trust = compute_trust_level(&tags, developer_type);
    let trust_level = if has_trust_metadata {
        trust.trust_level.clone()
    } else {
        explicit_trust_level
    };
    object.insert("trustLevel".into(), Value::String(trust_level.clone()));
    object.insert("$trustLevel".into(), Value::String(trust_level));
    if has_trust_metadata {
        object.insert("$trustClass".into(), Value::String(trust.trust_class));
        object.insert("$trustSortNum".into(), json!(trust.trust_sort_num));
        object.insert("$isModerator".into(), Value::Bool(trust.is_moderator));
        object.insert("$isTroll".into(), Value::Bool(trust.is_troll));
        object.insert(
            "$isProbableTroll".into(),
            Value::Bool(trust.is_probable_troll),
        );
    }
}

pub(super) fn event_user_id(content: &Value) -> Option<String> {
    let user_id = content
        .get("userId")
        .and_then(Value::as_str)
        .or_else(|| {
            content
                .get("user")
                .and_then(|user| user.get("id"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
        .trim()
        .to_string();
    (!user_id.is_empty()).then_some(user_id)
}

pub(super) fn event_user_patch(content: &Value, user_id: &str) -> Option<Value> {
    let user = content.get("user")?.as_object()?;
    let mut patch = user.clone();
    patch.insert("id".into(), Value::String(user_id.to_string()));
    patch.remove("state");
    vrcx_0_core::friends::strip_default_avatar_image(&mut patch);
    Some(Value::Object(patch))
}

pub(super) fn has_embedded_location_user(content: &Value) -> bool {
    content
        .get("user")
        .and_then(|user| user.get("id"))
        .and_then(Value::as_str)
        .map(|id| !id.trim().is_empty())
        .unwrap_or(false)
}

pub(super) fn state_bucket_changed(previous: &FriendRecord, next_state_bucket: &str) -> bool {
    [previous.state_bucket.as_str(), previous.state.as_str()]
        .into_iter()
        .find_map(normalize_state_bucket)
        .map(|previous_state_bucket| previous_state_bucket != next_state_bucket)
        .unwrap_or(false)
}

pub(super) fn is_online_location_proof(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    !normalized.is_empty() && normalized != "offline" && normalized != "offline:offline"
}

pub(super) fn online_patch(
    content: &Value,
    user_patch: serde_json::Value,
    previous: Option<&FriendRecord>,
    now: &EventTime,
    state_bucket: &str,
) -> serde_json::Value {
    let mut patch = user_patch.as_object().cloned().unwrap_or_default();
    if let Some(platform) = content.get("platform").and_then(Value::as_str) {
        patch.insert("platform".into(), Value::String(platform.to_string()));
    }
    patch.insert("state".into(), Value::String(state_bucket.to_string()));
    patch.insert("pendingOffline".into(), Value::Bool(false));

    let event_location = first_string([
        patch.get("location").and_then(Value::as_str),
        content.get("location").and_then(Value::as_str),
    ]);
    let event_traveling = first_string([
        patch.get("travelingToLocation").and_then(Value::as_str),
        content.get("travelingToLocation").and_then(Value::as_str),
    ]);
    let event_world = first_string([
        patch.get("worldId").and_then(Value::as_str),
        content.get("worldId").and_then(Value::as_str),
    ]);
    let fallback = previous.filter(|previous| {
        let location = previous.location.to_ascii_lowercase();
        !location.is_empty() && location != "offline" && location != "offline:offline"
    });
    let location = first_string([
        Some(event_location.as_str()),
        fallback.map(|record| record.location.as_str()),
    ]);
    let traveling = first_string([
        Some(event_traveling.as_str()),
        fallback.map(|record| record.traveling_to_location.as_str()),
    ]);
    patch.insert("location".into(), Value::String(location.clone()));
    insert_location_projection(&mut patch, &location, "worldId", "instanceId", "$location");
    if !event_world.is_empty() {
        patch.insert("worldId".into(), Value::String(event_world));
    }
    patch.insert(
        "travelingToLocation".into(),
        Value::String(traveling.clone()),
    );
    insert_location_projection(
        &mut patch,
        &traveling,
        "travelingToWorld",
        "travelingToInstance",
        "$travelingToLocation",
    );
    add_location_metadata(&mut patch, previous, now.timestamp_ms);
    Value::Object(patch)
}

fn insert_location_projection(
    patch: &mut Map<String, Value>,
    location: &str,
    world_id_key: &str,
    instance_id_key: &str,
    projection_key: &str,
) {
    let parsed = parse_location(location);
    patch.insert(world_id_key.into(), Value::String(parsed.world_id.clone()));
    patch.insert(
        instance_id_key.into(),
        Value::String(parsed.instance_id.clone()),
    );
    patch.insert(projection_key.into(), parsed.to_frontend_value(location));
}

pub(super) fn normalize_friend_update_location_patch(
    patch: &mut Value,
    previous: Option<&FriendRecord>,
    now: &EventTime,
) {
    let Some(patch) = patch.as_object_mut() else {
        return;
    };
    let Some(location) = patch
        .get("location")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    insert_location_projection(patch, &location, "worldId", "instanceId", "$location");
    if let Some(traveling_to_location) = patch
        .get("travelingToLocation")
        .and_then(Value::as_str)
        .map(str::to_string)
    {
        insert_location_projection(
            patch,
            &traveling_to_location,
            "travelingToWorld",
            "travelingToInstance",
            "$travelingToLocation",
        );
    }
    add_location_metadata(patch, previous, now.timestamp_ms);
}

pub(super) fn offline_like_patch(content: &Value, user_id: &str, state_bucket: &str) -> Value {
    let mut patch = content
        .get("user")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    patch.remove("state");
    patch.insert("id".into(), Value::String(user_id.to_string()));
    if let Some(platform) = content.get("platform").and_then(Value::as_str) {
        patch.insert("platform".into(), Value::String(platform.to_string()));
    }
    patch.insert("state".into(), Value::String(state_bucket.to_string()));
    patch.insert("pendingOffline".into(), Value::Bool(false));
    patch.insert("location".into(), Value::String("offline".into()));
    patch.insert("worldId".into(), Value::String("offline".into()));
    patch.insert("instanceId".into(), Value::String("".into()));
    patch.insert(
        "travelingToLocation".into(),
        Value::String("offline".into()),
    );
    patch.insert("travelingToWorld".into(), Value::String("offline".into()));
    patch.insert("travelingToInstance".into(), Value::String("".into()));
    let parsed_offline = parse_location("offline");
    patch.insert(
        "$location".into(),
        parsed_offline.to_frontend_value("offline"),
    );
    patch.insert(
        "$travelingToLocation".into(),
        parsed_offline.to_frontend_value("offline"),
    );
    Value::Object(patch)
}
