use std::collections::HashMap;

use serde_json::{Map, Number, Value};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct UserFact {
    pub fields: Map<String, Value>,
    pub field_ranks: HashMap<String, i64>,
    pub field_sources: HashMap<String, String>,
    pub updated_at: String,
}

impl UserFact {
    pub fn id(&self) -> &str {
        self.fields.get("id").and_then(Value::as_str).unwrap_or("")
    }

    pub fn endpoint(&self) -> &str {
        self.fields
            .get("endpoint")
            .and_then(Value::as_str)
            .unwrap_or("")
    }

    pub fn to_object(&self) -> Map<String, Value> {
        let mut object = self.fields.clone();
        apply_derived_fields(&mut object);
        object.insert("updatedAt".into(), Value::String(self.updated_at.clone()));
        object.insert(
            "fieldRanks".into(),
            Value::Object(
                self.field_ranks
                    .iter()
                    .map(|(key, rank)| (key.clone(), Value::from(*rank)))
                    .collect(),
            ),
        );
        object.insert(
            "fieldSources".into(),
            Value::Object(
                self.field_sources
                    .iter()
                    .map(|(key, source)| (key.clone(), Value::String(source.clone())))
                    .collect(),
            ),
        );
        object
    }
}

fn insert_derived_trust_fields(object: &mut Map<String, Value>) {
    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let developer_type = object
        .get("developerType")
        .and_then(Value::as_str)
        .unwrap_or("");
    let trust = crate::trust::compute_trust_level(&tags, developer_type);
    let platform = object.get("platform").and_then(Value::as_str).unwrap_or("");
    let last_platform = object
        .get("last_platform")
        .and_then(Value::as_str)
        .unwrap_or("");
    let effective_platform = crate::trust::compute_user_platform(platform, last_platform);

    object.insert("$trustLevel".into(), Value::String(trust.trust_level));
    object.insert("$trustClass".into(), Value::String(trust.trust_class));
    object.insert(
        "$trustSortNum".into(),
        Number::from_f64(trust.trust_sort_num)
            .map(Value::Number)
            .unwrap_or(Value::Null),
    );
    object.insert("$isModerator".into(), Value::Bool(trust.is_moderator));
    object.insert("$isTroll".into(), Value::Bool(trust.is_troll));
    object.insert(
        "$isProbableTroll".into(),
        Value::Bool(trust.is_probable_troll),
    );
    object.insert("$platform".into(), Value::String(effective_platform));
}

fn insert_derived_location_fields(object: &mut Map<String, Value>) {
    for (source, derived) in [
        ("location", "$location"),
        ("travelingToLocation", "$travelingToLocation"),
    ] {
        let Some(tag) = object.get(source).and_then(Value::as_str) else {
            continue;
        };
        let value = crate::location::parse_location(tag).to_frontend_value(tag);
        object.insert(derived.into(), value);
    }
}

pub fn apply_derived_fields(object: &mut Map<String, Value>) {
    insert_derived_trust_fields(object);
    insert_derived_location_fields(object);
}

#[derive(Clone, Debug)]
pub struct UserFactMergeOptions {
    pub endpoint: String,
    pub source: String,
    pub received_at: String,
    pub is_current_user: bool,
    pub is_friend: bool,
    pub state_bucket: String,
}

impl Default for UserFactMergeOptions {
    fn default() -> Self {
        Self {
            endpoint: String::new(),
            source: "seed".into(),
            received_at: String::new(),
            is_current_user: false,
            is_friend: false,
            state_bucket: String::new(),
        }
    }
}

pub struct UserFactMergeResult {
    pub fact: UserFact,
    pub changed: bool,
}

fn base_source_rank(source: &str) -> i64 {
    match source {
        "seed" => 10,
        "instance" => 20,
        "playerSnapshot" => 35,
        "friend" => 50,
        "profile" => 70,
        "realtime" => 75,
        "currentUser" => 85,
        "gameRuntime" => 90,
        _ => 0,
    }
}

fn profile_source_rank(source: &str) -> i64 {
    match source {
        "seed" => 10,
        "instance" => 20,
        "playerSnapshot" => 30,
        "realtime" => 40,
        "friend" => 55,
        "profile" => 80,
        "currentUser" => 90,
        "gameRuntime" => 50,
        _ => 0,
    }
}

fn presence_source_rank(source: &str) -> i64 {
    match source {
        "seed" => 10,
        "instance" => 45,
        "playerSnapshot" => 60,
        "profile" => 40,
        "currentUser" => 65,
        "friend" => 70,
        "realtime" => 80,
        "gameRuntime" => 90,
        _ => 0,
    }
}

fn is_presence_field(field: &str) -> bool {
    matches!(
        field,
        "status"
            | "statusDescription"
            | "state"
            | "stateBucket"
            | "location"
            | "travelingToLocation"
            | "locationAt"
            | "travelingToTime"
            | "pendingOffline"
    )
}

fn is_profile_field(field: &str) -> bool {
    matches!(
        field,
        "username"
            | "displayName"
            | "userIcon"
            | "profilePicOverride"
            | "profilePicOverrideThumbnail"
            | "thumbnailUrl"
            | "currentAvatar"
            | "currentAvatarImageUrl"
            | "currentAvatarThumbnailImageUrl"
            | "currentAvatarName"
            | "friendNumber"
            | "tags"
            | "platform"
            | "last_platform"
            | "developerType"
    )
}

fn is_self_field(field: &str) -> bool {
    matches!(field, "isBoopingEnabled" | "hasSharedConnectionsOptOut")
}

fn rank_for_field(field: &str, source: &str) -> i64 {
    if is_presence_field(field) {
        presence_source_rank(source)
    } else if is_profile_field(field) {
        profile_source_rank(source)
    } else if is_self_field(field) {
        if source == "currentUser" || source == "gameRuntime" {
            95
        } else {
            base_source_rank(source)
        }
    } else {
        base_source_rank(source)
    }
}

fn user_fact_field_name(field: &str) -> Option<&'static str> {
    Some(match field {
        "id" => "id",
        "username" => "username",
        "displayName" => "displayName",
        "userIcon" => "userIcon",
        "profilePicOverride" => "profilePicOverride",
        "profilePicOverrideThumbnail" => "profilePicOverrideThumbnail",
        "thumbnailUrl" => "thumbnailUrl",
        "currentAvatar" => "currentAvatar",
        "currentAvatarImageUrl" => "currentAvatarImageUrl",
        "currentAvatarThumbnailImageUrl" => "currentAvatarThumbnailImageUrl",
        "currentAvatarName" => "currentAvatarName",
        "status" => "status",
        "statusDescription" => "statusDescription",
        "state" => "state",
        "stateBucket" => "stateBucket",
        "location" => "location",
        "travelingToLocation" => "travelingToLocation",
        "locationAt" => "locationAt",
        "travelingToTime" => "travelingToTime",
        "pendingOffline" => "pendingOffline",
        "friendNumber" => "friendNumber",
        "isBoopingEnabled" => "isBoopingEnabled",
        "hasSharedConnectionsOptOut" => "hasSharedConnectionsOptOut",
        "tags" => "tags",
        "platform" => "platform",
        "last_platform" => "last_platform",
        "developerType" => "developerType",
        _ => return None,
    })
}

fn resolve_field(raw: &str) -> Option<&'static str> {
    match raw {
        "display_name" | "name" => Some("displayName"),
        "user_id" | "userId" => Some("id"),
        "$travelingToLocation" => Some("travelingToLocation"),
        "location_at" | "$location_at" | "joinedAt" | "joined_at" | "$online_for" => {
            Some("locationAt")
        }
        "$travelingToTime" => Some("travelingToTime"),
        "$friendNumber" => Some("friendNumber"),
        other => user_fact_field_name(other),
    }
}

pub fn normalize_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.trim().to_string(),
        Value::Null => String::new(),
        other => other.to_string().trim().to_string(),
    }
}

pub fn normalize_user_id(value: &Value) -> String {
    normalize_text(value)
}

pub fn normalize_endpoint(value: &Value) -> String {
    let text = normalize_text(value);
    if text.is_empty() {
        "default".to_string()
    } else {
        text
    }
}

pub fn user_fact_key(endpoint: &Value, user_id: &Value) -> String {
    let normalized_user_id = normalize_user_id(user_id);
    if normalized_user_id.is_empty() {
        String::new()
    } else {
        format!("{}::{}", normalize_endpoint(endpoint), normalized_user_id)
    }
}

pub fn normalize_state_bucket(value: &Value) -> String {
    match normalize_text(value).to_ascii_lowercase().as_str() {
        "online" => "online".to_string(),
        "active" => "active".to_string(),
        "offline" => "offline".to_string(),
        _ => String::new(),
    }
}

fn is_present(value: &Value) -> bool {
    if value.is_null() {
        return false;
    }
    if let Some(text) = value.as_str() {
        return !text.is_empty();
    }
    true
}

fn normalize_fact_patch(input: &Value) -> Map<String, Value> {
    let mut patch = Map::new();
    let Some(object) = input.as_object() else {
        return patch;
    };
    for (raw_key, value) in object {
        let Some(key) = resolve_field(raw_key) else {
            continue;
        };
        match key {
            "id" => {
                let id = normalize_user_id(value);
                if !id.is_empty() {
                    patch.insert("id".into(), Value::String(id));
                }
            }
            "stateBucket" => {
                let state_bucket = normalize_state_bucket(value);
                if !state_bucket.is_empty() {
                    patch.insert("stateBucket".into(), Value::String(state_bucket));
                }
            }
            "friendNumber" => {
                let parsed = value.as_i64().or_else(|| {
                    value
                        .as_str()
                        .and_then(|text| text.trim().parse::<i64>().ok())
                });
                if let Some(friend_number) = parsed {
                    if friend_number > 0 {
                        patch.insert("friendNumber".into(), Value::from(friend_number));
                    }
                }
            }
            "tags" => {
                if value.is_array() {
                    patch.insert("tags".into(), value.clone());
                }
            }
            other => {
                if is_present(value) {
                    patch.insert(other.to_string(), value.clone());
                }
            }
        }
    }
    patch
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn merge_user_fact(
    existing: Option<&UserFact>,
    input: &Value,
    options: &UserFactMergeOptions,
) -> UserFactMergeResult {
    let patch = normalize_fact_patch(input);

    let id = {
        let from_patch = patch.get("id").map(normalize_user_id).unwrap_or_default();
        if from_patch.is_empty() {
            existing
                .map(|fact| fact.id().to_string())
                .unwrap_or_default()
        } else {
            from_patch
        }
    };
    let endpoint = {
        let candidate = if options.endpoint.is_empty() {
            existing
                .map(|fact| fact.endpoint().to_string())
                .unwrap_or_default()
        } else {
            options.endpoint.clone()
        };
        normalize_endpoint(&Value::String(candidate))
    };
    let normalized_state_bucket = {
        let from_options = normalize_state_bucket(&Value::String(options.state_bucket.clone()));
        if from_options.is_empty() {
            patch
                .get("stateBucket")
                .map(normalize_state_bucket)
                .unwrap_or_default()
        } else {
            from_options
        }
    };
    let updated_at = {
        let received = normalize_text(&Value::String(options.received_at.clone()));
        if received.is_empty() {
            now_iso()
        } else {
            received
        }
    };

    let mut fact = match existing {
        Some(existing) => existing.clone(),
        None => UserFact {
            fields: {
                let mut fields = Map::new();
                fields.insert("id".into(), Value::String(id.clone()));
                fields.insert("endpoint".into(), Value::String(endpoint.clone()));
                fields
            },
            field_ranks: HashMap::new(),
            field_sources: HashMap::new(),
            updated_at: updated_at.clone(),
        },
    };
    let mut changed = existing.is_none();

    if !id.is_empty() && fact.id() != id {
        fact.fields.insert("id".into(), Value::String(id));
        changed = true;
    }
    if !endpoint.is_empty() && fact.endpoint() != endpoint {
        fact.fields
            .insert("endpoint".into(), Value::String(endpoint));
        changed = true;
    }
    if options.is_current_user
        && fact.fields.get("isCurrentUser").and_then(Value::as_bool) != Some(true)
    {
        fact.fields
            .insert("isCurrentUser".into(), Value::Bool(true));
        changed = true;
    }
    if options.is_friend && fact.fields.get("isFriend").and_then(Value::as_bool) != Some(true) {
        fact.fields.insert("isFriend".into(), Value::Bool(true));
        changed = true;
    }

    let mut patch = patch;
    if !normalized_state_bucket.is_empty() {
        patch.insert("stateBucket".into(), Value::String(normalized_state_bucket));
    }

    for (field, value) in &patch {
        if field == "id" || !is_present(value) {
            continue;
        }
        let rank = rank_for_field(field, &options.source);
        let existing_rank = fact.field_ranks.get(field).copied().unwrap_or(0);
        if rank < existing_rank {
            continue;
        }
        if fact.fields.get(field) != Some(value) {
            fact.fields.insert(field.clone(), value.clone());
            changed = true;
        }
        if fact.field_ranks.get(field).copied() != Some(rank) {
            fact.field_ranks.insert(field.clone(), rank);
            fact.field_sources
                .insert(field.clone(), options.source.clone());
            changed = true;
        }
    }

    if changed && fact.updated_at != updated_at {
        fact.updated_at = updated_at;
    }

    if changed {
        UserFactMergeResult { fact, changed }
    } else {
        UserFactMergeResult {
            fact: existing.cloned().unwrap_or(fact),
            changed: false,
        }
    }
}

pub fn number_value(value: i64) -> Value {
    Value::Number(Number::from(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opts(source: &str) -> UserFactMergeOptions {
        UserFactMergeOptions {
            endpoint: "https://api.example.test".into(),
            source: source.into(),
            received_at: "2026-06-16T00:00:00Z".into(),
            ..Default::default()
        }
    }

    #[test]
    fn to_object_emits_derived_trust_and_platform() {
        let result = merge_user_fact(
            None,
            &json!({
                "id": "usr_1",
                "tags": ["system_trust_veteran"],
                "platform": "standalonewindows"
            }),
            &opts("profile"),
        );
        let object = result.fact.to_object();
        assert_eq!(
            object.get("$trustLevel").and_then(Value::as_str),
            Some("Trusted User")
        );
        assert_eq!(
            object.get("$trustClass").and_then(Value::as_str),
            Some("x-tag-veteran")
        );
        assert_eq!(
            object.get("$platform").and_then(Value::as_str),
            Some("standalonewindows")
        );
        assert_eq!(
            object.get("$isModerator").and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn to_object_derives_full_location_projection() {
        let tag = "wrld_a:1~group(grp_a)~groupAccessType(plus)";
        let result = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "location": tag }),
            &opts("realtime"),
        );
        let object = result.fact.to_object();
        let location = object.get("$location").expect("derived location");

        assert_eq!(object.get("location"), Some(&json!(tag)));
        assert_eq!(location["tag"], json!(tag));
        assert_eq!(location["isRealInstance"], json!(true));
        assert_eq!(location["worldId"], json!("wrld_a"));
        assert_eq!(
            location["instanceId"],
            json!("1~group(grp_a)~groupAccessType(plus)")
        );
        assert_eq!(location["accessType"], json!("group"));
        assert_eq!(location["accessTypeName"], json!("groupPlus"));
        assert_eq!(location["groupId"], json!("grp_a"));
        assert_eq!(location["groupAccessType"], json!("plus"));
    }

    #[test]
    fn pending_offline_whitelisted_and_realtime_outranks_stale_profile() {
        let online = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "pendingOffline": true }),
            &opts("realtime"),
        );
        assert_eq!(
            online
                .fact
                .fields
                .get("pendingOffline")
                .and_then(Value::as_bool),
            Some(true)
        );
        let cleared = merge_user_fact(
            Some(&online.fact),
            &json!({ "id": "usr_1", "pendingOffline": false }),
            &opts("realtime"),
        );
        assert_eq!(
            cleared
                .fact
                .fields
                .get("pendingOffline")
                .and_then(Value::as_bool),
            Some(false)
        );
        let stale = merge_user_fact(
            Some(&cleared.fact),
            &json!({ "id": "usr_1", "pendingOffline": true }),
            &opts("profile"),
        );
        assert_eq!(
            stale
                .fact
                .fields
                .get("pendingOffline")
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn aliases_and_whitelist_normalize_input() {
        let result = merge_user_fact(
            None,
            &json!({
                "user_id": "usr_1",
                "display_name": "Alice",
                "$location_at": 123,
                "unknown_field": "drop me"
            }),
            &opts("friend"),
        );
        let f = &result.fact.fields;
        assert_eq!(f.get("id").and_then(Value::as_str), Some("usr_1"));
        assert_eq!(f.get("displayName").and_then(Value::as_str), Some("Alice"));
        assert_eq!(f.get("locationAt"), Some(&json!(123)));
        assert!(!f.contains_key("unknown_field"));
    }

    #[test]
    fn presence_realtime_beats_profile_but_profile_beats_friend_for_profile_fields() {
        let first = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "state": "online" }),
            &opts("realtime"),
        );
        let second = merge_user_fact(
            Some(&first.fact),
            &json!({ "id": "usr_1", "state": "offline", "displayName": "FromProfile" }),
            &opts("profile"),
        );
        assert_eq!(
            second.fact.fields.get("state").and_then(Value::as_str),
            Some("online"),
            "WS presence must win over lagging API state"
        );
        assert_eq!(
            second
                .fact
                .fields
                .get("displayName")
                .and_then(Value::as_str),
            Some("FromProfile")
        );
        assert_eq!(
            second.fact.field_sources.get("state").map(String::as_str),
            Some("realtime")
        );
    }

    #[test]
    fn missing_or_empty_fields_do_not_overwrite_existing() {
        let first = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "displayName": "Alice" }),
            &opts("profile"),
        );
        let second = merge_user_fact(
            Some(&first.fact),
            &json!({ "id": "usr_1", "displayName": "" }),
            &opts("currentUser"),
        );
        assert_eq!(
            second
                .fact
                .fields
                .get("displayName")
                .and_then(Value::as_str),
            Some("Alice")
        );
    }

    #[test]
    fn unchanged_merge_reports_not_changed() {
        let first = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "state": "online" }),
            &opts("realtime"),
        );
        let again = merge_user_fact(
            Some(&first.fact),
            &json!({ "id": "usr_1", "state": "online" }),
            &opts("realtime"),
        );
        assert!(!again.changed);
    }

    #[test]
    fn state_bucket_normalizes_and_friend_number_parses() {
        let result = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "stateBucket": "ONLINE", "friendNumber": "42" }),
            &opts("friend"),
        );
        assert_eq!(
            result
                .fact
                .fields
                .get("stateBucket")
                .and_then(Value::as_str),
            Some("online")
        );
        assert_eq!(result.fact.fields.get("friendNumber"), Some(&json!(42)));
    }

    #[test]
    fn user_fact_key_is_endpoint_scoped() {
        assert_eq!(
            user_fact_key(&json!("https://api.example.test"), &json!("usr_1")),
            "https://api.example.test::usr_1"
        );
        assert_eq!(user_fact_key(&json!(""), &json!("usr_1")), "default::usr_1");
        assert_eq!(user_fact_key(&json!("ep"), &json!("")), "");
    }

    #[test]
    fn friend_presence_beats_profile_but_profile_name_beats_friend() {
        let friend = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "state": "active", "displayName": "FriendName" }),
            &opts("friend"),
        );
        let after = merge_user_fact(
            Some(&friend.fact),
            &json!({ "id": "usr_1", "state": "offline", "displayName": "ProfileName" }),
            &opts("profile"),
        );
        assert_eq!(
            after.fact.fields.get("state").and_then(Value::as_str),
            Some("active")
        );
        assert_eq!(
            after.fact.fields.get("displayName").and_then(Value::as_str),
            Some("ProfileName")
        );
    }

    #[test]
    fn low_rank_occupancy_sources_never_override_authoritative_presence() {
        let realtime = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "location": "wrld_auth:1" }),
            &opts("realtime"),
        );
        for source in ["instance", "playerSnapshot", "seed", "profile"] {
            let after = merge_user_fact(
                Some(&realtime.fact),
                &json!({ "id": "usr_1", "location": "wrld_stale:2" }),
                &opts(source),
            );
            assert_eq!(
                after.fact.fields.get("location").and_then(Value::as_str),
                Some("wrld_auth:1"),
                "{source} must not override realtime presence location"
            );
        }
    }

    #[test]
    fn self_fields_are_owned_by_current_user() {
        let profile = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "isBoopingEnabled": true }),
            &opts("profile"),
        );
        let after = merge_user_fact(
            Some(&profile.fact),
            &json!({ "id": "usr_1", "isBoopingEnabled": false }),
            &opts("currentUser"),
        );
        assert_eq!(
            after
                .fact
                .fields
                .get("isBoopingEnabled")
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn game_runtime_presence_is_highest() {
        let realtime = merge_user_fact(
            None,
            &json!({ "id": "usr_1", "location": "wrld_ws:1" }),
            &opts("realtime"),
        );
        let after = merge_user_fact(
            Some(&realtime.fact),
            &json!({ "id": "usr_1", "location": "wrld_local:2" }),
            &opts("gameRuntime"),
        );
        assert_eq!(
            after.fact.fields.get("location").and_then(Value::as_str),
            Some("wrld_local:2")
        );
    }
}
