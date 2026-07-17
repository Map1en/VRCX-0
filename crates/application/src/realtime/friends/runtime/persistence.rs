use super::event_patch::record_to_value;
use super::utils::*;
use super::*;

#[derive(Clone, Debug)]
pub(super) struct FriendFieldChange {
    next: Value,
    previous: Value,
}

#[derive(Clone, Debug, Default)]
pub(super) struct FriendChangedProps {
    changes: HashMap<String, FriendFieldChange>,
}

impl FriendChangedProps {
    pub(super) fn from_patch(patch: &Value, previous: Option<&Value>) -> Self {
        let Some(previous) = previous else {
            return Self::default();
        };
        let Some(patch_object) = patch.as_object() else {
            return Self::default();
        };
        let mut changes = HashMap::new();
        for (key, next) in patch_object {
            let previous = previous_value_for_diff(previous, key);
            if value_equal_for_diff(next, &previous) {
                continue;
            }
            changes.insert(
                key.clone(),
                FriendFieldChange {
                    next: next.clone(),
                    previous,
                },
            );
        }
        Self { changes }
    }

    fn get(&self, key: &str) -> Option<&FriendFieldChange> {
        self.changes.get(key)
    }

    pub(super) fn has(&self, key: &str) -> bool {
        self.changes.contains_key(key)
    }
}

fn previous_value_for_diff(previous: &Value, key: &str) -> Value {
    previous.get(key).cloned().unwrap_or_else(|| match key {
        "currentAvatarTags" => json!([]),
        _ => Value::String(String::new()),
    })
}

pub(super) fn value_equal_for_diff(next: &Value, previous: &Value) -> bool {
    if next == previous {
        return true;
    }
    let next_empty_string = next.as_str().map(|value| value.is_empty()).unwrap_or(false);
    let previous_empty_string = previous
        .as_str()
        .map(|value| value.is_empty())
        .unwrap_or(false);
    next.is_null() && previous_empty_string || previous.is_null() && next_empty_string
}

pub(super) fn friend_log_upsert(
    user_id: &str,
    patch: &Value,
    previous: Option<&Value>,
    _state_bucket: &str,
    created_at: &str,
) -> FriendLogUpsert {
    FriendLogUpsert {
        target_user_id: user_id.to_string(),
        display_name: display_name(user_id, patch, previous),
        trust_level: first_owned([
            string_field(patch.get("$trustLevel")),
            string_field(patch.get("trustLevel")),
            previous
                .map(|previous| string_field(previous.get("$trustLevel")))
                .unwrap_or_default(),
            previous
                .map(|previous| string_field(previous.get("trustLevel")))
                .unwrap_or_default(),
        ]),
        friend_number: int_field(patch.get("$friendNumber"))
            .or_else(|| int_field(patch.get("friendNumber")))
            .or_else(|| previous.and_then(|previous| int_field(previous.get("$friendNumber"))))
            .or_else(|| previous.and_then(|previous| int_field(previous.get("friendNumber"))))
            .unwrap_or(0),
        created_at: created_at.to_string(),
        force_history: false,
    }
}

pub(crate) fn trust_level_feed_entry(
    created_at: &str,
    user_id: &str,
    display_name: &str,
    trust_level: &str,
    previous_trust_level: &str,
    friend_number: i64,
) -> Value {
    json!({
        "created_at": created_at,
        "type": "TrustLevel",
        "userId": user_id,
        "displayName": display_name,
        "trustLevel": trust_level,
        "previousTrustLevel": previous_trust_level,
        "friendNumber": friend_number,
    })
}

pub(super) fn add_profile_diff_feed_entries(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    previous: Option<&Value>,
    changes: &FriendChangedProps,
    created_at: &str,
) {
    let Some(previous) = previous.filter(|previous| is_online_value(previous)) else {
        return;
    };
    let status_changed = changes.has("status");
    let status_description_changed = changes.has("statusDescription");
    let next_status = string_or_previous(patch, previous, "status");
    let previous_status = string_field(previous.get("status"));
    if (status_changed || status_description_changed)
        && next_status != "offline"
        && previous_status != "offline"
    {
        output.persistence.feed_entries.push(json!({
            "created_at": created_at,
            "type": "Status",
            "userId": user_id,
            "displayName": display_name(user_id, patch, Some(previous)),
            "status": next_status,
            "statusDescription": string_or_previous(patch, previous, "statusDescription"),
            "previousStatus": previous_status,
            "previousStatusDescription": string_field(previous.get("statusDescription")),
        }));
    }
    if changes.has("bio")
        && !string_field(patch.get("bio")).is_empty()
        && !string_field(previous.get("bio")).is_empty()
    {
        output.persistence.feed_entries.push(json!({
            "created_at": created_at,
            "type": "Bio",
            "userId": user_id,
            "displayName": display_name(user_id, patch, Some(previous)),
            "bio": string_field(patch.get("bio")),
            "previousBio": string_field(previous.get("bio")),
        }));
    }
    let avatar_image_changed =
        changes.has("currentAvatarImageUrl") || changes.has("currentAvatarThumbnailImageUrl");
    let avatar_tags_changed = changes.has("currentAvatarTags");
    let profile_pic_override = string_or_previous(patch, previous, "profilePicOverride");
    let should_write_avatar =
        (avatar_image_changed && profile_pic_override.is_empty()) || avatar_tags_changed;
    let current_avatar = first_owned([
        string_or_previous(patch, previous, "currentAvatarImageUrl"),
        string_or_previous(patch, previous, "currentAvatarThumbnailImageUrl"),
    ]);
    let previous_avatar = first_owned([
        string_field(previous.get("currentAvatarImageUrl")),
        string_field(previous.get("currentAvatarThumbnailImageUrl")),
    ]);
    if should_write_avatar && !previous_avatar.is_empty() && !current_avatar.is_empty() {
        let current_avatar_tags = changes
            .get("currentAvatarTags")
            .map(|change| change.next.clone())
            .or_else(|| previous.get("currentAvatarTags").cloned())
            .unwrap_or_else(|| json!([]));
        let previous_avatar_tags = changes
            .get("currentAvatarTags")
            .map(|change| change.previous.clone())
            .or_else(|| previous.get("currentAvatarTags").cloned())
            .unwrap_or_else(|| json!([]));
        output.persistence.feed_entries.push(json!({
            "created_at": created_at,
            "type": "Avatar",
            "userId": user_id,
            "displayName": display_name(user_id, patch, Some(previous)),
            "ownerId": first_owned([
                string_field(patch.get("currentAvatarAuthorId")),
                string_field(patch.get("authorId")),
                string_field(previous.get("currentAvatarAuthorId")),
                string_field(previous.get("authorId")),
            ]),
            "previousOwnerId": first_owned([
                string_field(previous.get("currentAvatarAuthorId")),
                string_field(previous.get("authorId")),
            ]),
            "avatarName": first_owned([
                string_field(patch.get("currentAvatarName")),
                string_field(patch.get("avatarName")),
                string_field(previous.get("currentAvatarName")),
                string_field(previous.get("avatarName")),
            ]),
            "previousAvatarName": first_owned([
                string_field(previous.get("currentAvatarName")),
                string_field(previous.get("avatarName")),
            ]),
            "currentAvatarImageUrl": string_or_previous(patch, previous, "currentAvatarImageUrl"),
            "currentAvatarThumbnailImageUrl": string_or_previous(patch, previous, "currentAvatarThumbnailImageUrl"),
            "previousCurrentAvatarImageUrl": string_field(previous.get("currentAvatarImageUrl")),
            "previousCurrentAvatarThumbnailImageUrl": string_field(previous.get("currentAvatarThumbnailImageUrl")),
            "currentAvatarTags": current_avatar_tags,
            "previousCurrentAvatarTags": previous_avatar_tags,
        }));
    }
}

pub(super) fn friend_relationship_feed_entry(
    entry_type: &str,
    user_id: &str,
    patch: &Value,
    previous: Option<&Value>,
    created_at: &str,
) -> Value {
    json!({
        "created_at": created_at,
        "type": entry_type,
        "userId": user_id,
        "displayName": display_name(user_id, patch, previous),
    })
}

pub(super) fn gps_feed_entry(
    user_id: &str,
    patch: &Value,
    previous: &Value,
    created_at: &str,
) -> Option<Value> {
    let previous_location = resolve_gps_previous_location(previous);
    let location = string_field(patch.get("location"));
    if !is_gps_feed_location(&previous_location)
        || !is_gps_feed_location(&location)
        || previous_location == location
    {
        return None;
    }
    let (world_name, group_name) = if is_real_location(&location) {
        resolve_location_name(&location, patch, Some(previous))
    } else {
        (String::new(), String::new())
    };
    Some(json!({
        "created_at": created_at,
        "type": "GPS",
        "userId": user_id,
        "displayName": display_name(user_id, patch, Some(previous)),
        "location": location,
        "worldName": world_name,
        "previousLocation": previous_location,
        "time": resolve_gps_duration(previous),
        "groupName": group_name,
    }))
}

pub(crate) fn player_joining_feed_entry(
    user_id: &str,
    was_traveling: bool,
    current: &FriendRecord,
    created_at: &str,
) -> Option<Value> {
    if was_traveling
        || !parse_location(&current.location).is_traveling
        || current.traveling_to_location.trim().is_empty()
    {
        return None;
    }
    Some(json!({
        "created_at": created_at,
        "type": "OnPlayerJoining",
        "userId": user_id,
        "displayName": current.display_name,
        "location": current.location,
        "travelingToLocation": current.traveling_to_location,
    }))
}

pub(super) fn online_offline_feed_entry(
    entry_type: &str,
    user_id: &str,
    patch: &Value,
    previous: &Value,
    location: &str,
    time: i64,
    created_at: &str,
) -> Value {
    let (world_name, group_name) = if is_real_location(location) {
        resolve_location_name(location, patch, Some(previous))
    } else {
        ("".to_string(), "".to_string())
    };
    json!({
        "created_at": created_at,
        "type": entry_type,
        "userId": user_id,
        "displayName": display_name(user_id, patch, Some(previous)),
        "location": location,
        "worldName": world_name,
        "groupName": group_name,
        "time": if time > 0 { json!(time) } else { json!("") },
    })
}

pub(super) fn offline_feed_entry(
    user_id: &str,
    patch: &Value,
    previous: &FriendRecord,
    created_at: &str,
    timestamp_ms: i64,
) -> Value {
    let previous_value = record_to_value(previous);
    let location = string_field(previous_value.get("location"));
    online_offline_feed_entry(
        "Offline",
        user_id,
        patch,
        &previous_value,
        &location,
        duration_ms(previous, timestamp_ms),
        created_at,
    )
}

pub(super) fn add_location_metadata(
    patch: &mut Map<String, Value>,
    previous: Option<&Value>,
    timestamp_ms: i64,
) {
    let location = string_field(patch.get("location"));
    if location.eq_ignore_ascii_case("traveling") {
        if previous
            .map(|previous| {
                string_field(previous.get("location")).eq_ignore_ascii_case("traveling")
            })
            .unwrap_or(false)
        {
            return;
        }
        let previous_location = previous.map(resolve_previous_location).unwrap_or_default();
        let previous_timestamp = previous
            .and_then(|previous| {
                int_field(previous.get("locationUpdatedAt"))
                    .or_else(|| int_field(previous.get("$location_at")))
            })
            .unwrap_or(0);
        patch.insert("locationUpdatedAt".into(), Value::from(timestamp_ms));
        patch.insert("$location_at".into(), Value::from(timestamp_ms));
        patch.insert("$travelingToTime".into(), Value::from(timestamp_ms));
        patch.insert("travelingToTime".into(), Value::from(timestamp_ms));
        if is_real_location(&previous_location) {
            patch.insert("$previousLocation".into(), Value::String(previous_location));
            patch.insert(
                "$previousLocation_at".into(),
                Value::from(previous_timestamp),
            );
        }
        return;
    }

    let previous_travel_location = previous
        .map(|previous| string_field(previous.get("$previousLocation")))
        .unwrap_or_default();
    let previous_location_timestamp = previous
        .and_then(|previous| int_field(previous.get("$previousLocation_at")))
        .unwrap_or(0);
    let returned_to_previous_location =
        !previous_travel_location.is_empty() && previous_travel_location == location;
    let location_timestamp = if returned_to_previous_location && previous_location_timestamp > 0 {
        previous_location_timestamp
    } else {
        timestamp_ms
    };
    patch.insert("locationUpdatedAt".into(), Value::from(location_timestamp));
    patch.insert("$location_at".into(), Value::from(location_timestamp));
    patch.insert("$previousLocation".into(), Value::String(String::new()));
    patch.insert("$previousLocation_at".into(), Value::String(String::new()));
    patch.insert("$travelingToTime".into(), Value::String(String::new()));
    patch.insert("travelingToTime".into(), Value::String(String::new()));
}

pub(super) fn display_name(user_id: &str, patch: &Value, previous: Option<&Value>) -> String {
    first_owned([
        meaningful_name(patch, user_id),
        previous
            .map(|previous| meaningful_name(previous, user_id))
            .unwrap_or_default(),
        "Unknown".to_string(),
    ])
}

pub(super) fn meaningful_name(value: &Value, user_id: &str) -> String {
    vrcx_0_core::friends::meaningful_display_name(
        &string_field(value.get("displayName")),
        &string_field(value.get("username")),
        user_id,
    )
    .unwrap_or_default()
}

pub(super) fn resolve_location_name(
    location: &str,
    patch: &Value,
    previous: Option<&Value>,
) -> (String, String) {
    let parsed = parse_location(location);
    (
        first_owned([
            string_field(patch.get("worldName")),
            patch
                .get("world")
                .and_then(|world| world.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            previous
                .map(|previous| string_field(previous.get("worldName")))
                .unwrap_or_default(),
            parsed.world_id.clone(),
            location.to_string(),
        ]),
        first_owned([
            string_field(patch.get("groupName")),
            previous
                .map(|previous| string_field(previous.get("groupName")))
                .unwrap_or_default(),
            parsed.group_id.clone().unwrap_or_default(),
        ]),
    )
}

pub(super) fn resolve_previous_location(previous: &Value) -> String {
    first_non_empty([
        string_field(previous.get("location")).as_str(),
        previous
            .get("$location")
            .and_then(|location| location.get("tag"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    ])
    .to_string()
}

pub(super) fn resolve_gps_previous_location(previous: &Value) -> String {
    let previous_location = string_field(previous.get("location"));
    if previous_location.eq_ignore_ascii_case("traveling") {
        return string_field(previous.get("$previousLocation"));
    }
    previous_location
}

pub(super) fn resolve_gps_duration(previous: &Value) -> i64 {
    if string_field(previous.get("location")).eq_ignore_ascii_case("traveling") {
        let previous_timestamp = int_field(previous.get("$previousLocation_at")).unwrap_or(0);
        return if previous_timestamp > 0 {
            Utc::now().timestamp_millis() - previous_timestamp
        } else {
            0
        };
    }
    match FriendRecord::deserialize(previous.clone()) {
        Ok(record) => duration_ms(&record, Utc::now().timestamp_millis()),
        Err(error) => {
            tracing::warn!("resolve_gps_duration friend record deserialize failed: {error}");
            0
        }
    }
}

pub(super) fn duration_ms(previous: &FriendRecord, now_ms: i64) -> i64 {
    let previous_value = record_to_value(previous);
    let timestamp = int_field(previous_value.get("locationUpdatedAt"))
        .or_else(|| int_field(previous_value.get("$location_at")))
        .unwrap_or(0);
    if timestamp > 0 {
        now_ms.saturating_sub(timestamp)
    } else {
        0
    }
}

pub(super) fn is_online_state(record: &FriendRecord) -> bool {
    record.state_bucket == "online" || record.state == "online"
}

pub(super) fn is_online_value(value: &Value) -> bool {
    string_field(value.get("stateBucket")) == "online"
        || string_field(value.get("state")) == "online"
}

pub(super) fn is_real_location(location: &str) -> bool {
    let location = location.trim().to_ascii_lowercase();
    if location.is_empty() || location.starts_with("local") {
        return false;
    }
    !matches!(
        location.as_str(),
        ":" | "offline"
            | "offline:offline"
            | "traveling"
            | "traveling:traveling"
            | "private"
            | "private:private"
    )
}

pub(super) fn is_private_location(location: &str) -> bool {
    matches!(
        location.trim().to_ascii_lowercase().as_str(),
        "private" | "private:private"
    )
}

fn is_gps_feed_location(location: &str) -> bool {
    is_real_location(location) || is_private_location(location)
}
