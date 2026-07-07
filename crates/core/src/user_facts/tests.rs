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
    assert!(!object.contains_key("fieldRanks"));
    assert!(!object.contains_key("fieldSources"));
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
