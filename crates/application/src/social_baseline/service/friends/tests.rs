use super::*;

#[test]
fn collect_suspicious_only_targets_mismatched_or_traveling_friends() {
    let expected_ids = vec![
        "usr_online".to_string(),
        "usr_active_pc".to_string(),
        "usr_traveling".to_string(),
        "usr_offline".to_string(),
    ];
    let state_by_id = HashMap::from([
        ("usr_online".to_string(), "online".to_string()),
        ("usr_active_pc".to_string(), "active".to_string()),
        ("usr_traveling".to_string(), "online".to_string()),
        ("usr_offline".to_string(), "offline".to_string()),
    ]);
    let profile = |id: &str, platform: &str, location: &str| {
        RemoteFriendProfile::from_raw(
            json!({ "id": id, "platform": platform, "location": location }),
            None,
        )
        .expect("valid profile")
    };
    let fetched_friends_by_id = HashMap::from([
        (
            "usr_online".to_string(),
            profile("usr_online", "standalonewindows", "wrld_1:1"),
        ),
        (
            "usr_active_pc".to_string(),
            profile("usr_active_pc", "standalonewindows", "offline"),
        ),
        (
            "usr_traveling".to_string(),
            profile("usr_traveling", "standalonewindows", "traveling"),
        ),
        (
            "usr_offline".to_string(),
            profile("usr_offline", "", "offline"),
        ),
    ]);

    let suspicious =
        collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);

    assert_eq!(
        suspicious,
        vec!["usr_active_pc".to_string(), "usr_traveling".to_string()]
    );
}

#[test]
fn collect_suspicious_flags_stale_online_friend() {
    let expected_ids = vec!["usr_stale".to_string()];
    let state_by_id = HashMap::from([("usr_stale".to_string(), "online".to_string())]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_stale".to_string(),
        RemoteFriendProfile::from_raw(
            json!({ "id": "usr_stale", "platform": "", "location": "offline" }),
            None,
        )
        .expect("valid profile"),
    )]);

    let suspicious =
        collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);

    assert_eq!(suspicious, vec!["usr_stale".to_string()]);
}

#[test]
fn insert_fetched_friend_collects_profile_and_prefers_online_source() {
    let mut fetched_friends_by_id = HashMap::new();
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();

    insert_fetched_friend(
        &mut fetched_friends_by_id,
        &mut ordered,
        &mut seen,
        json!({ "id": "usr_friend", "state": "online", "location": "offline" }),
        Some("offline"),
    );
    insert_fetched_friend(
        &mut fetched_friends_by_id,
        &mut ordered,
        &mut seen,
        json!({ "id": "usr_friend", "location": "wrld_live:123" }),
        Some("online"),
    );

    assert_eq!(ordered, vec!["usr_friend".to_string()]);
    let profile = fetched_friends_by_id
        .get("usr_friend")
        .expect("inserted friend profile");
    assert_eq!(profile.source_state_bucket.as_deref(), Some("online"));
    assert_eq!(
        object_field_string(&profile.raw, &["location"]),
        "wrld_live:123"
    );
}

#[test]
fn fast_roster_snapshot_uses_current_user_ids_and_remote_profiles_without_friend_log() {
    let expected_ids = vec!["usr_online".to_string(), "usr_missing".to_string()];
    let state_by_id = HashMap::from([
        ("usr_online".to_string(), "online".to_string()),
        ("usr_missing".to_string(), "offline".to_string()),
    ]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_online".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_online",
                "displayName": "Online Friend",
                "location": "wrld_live:123",
                "platform": "standalonewindows",
                "tags": ["system_trust_known"]
            }),
            Some("online"),
        )
        .expect("valid profile"),
    )]);

    let snapshot = build_fast_roster_snapshot(
        "usr_self",
        &expected_ids,
        &state_by_id,
        &fetched_friends_by_id,
    );

    let friends_by_id = snapshot
        .get("friendsById")
        .and_then(Value::as_object)
        .expect("friendsById object");
    assert_eq!(
        friends_by_id
            .get("usr_online")
            .and_then(|friend| object_field(friend, "displayName"))
            .and_then(Value::as_str),
        Some("Online Friend")
    );
    assert_eq!(
        friends_by_id
            .get("usr_online")
            .and_then(|friend| object_field(friend, "location"))
            .and_then(Value::as_str),
        Some("wrld_live:123")
    );
    assert_eq!(
        friends_by_id
            .get("usr_missing")
            .and_then(|friend| object_field(friend, "displayName"))
            .and_then(Value::as_str),
        Some("usr_missing")
    );
    assert_eq!(
        snapshot
            .get("orderedFriendIds")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        vec![json!("usr_online"), json!("usr_missing")]
    );
}

#[test]
fn placeholder_friend_uses_realtime_list_bucket() {
    let expected_ids = vec!["usr_stale".to_string()];
    let state_by_id = HashMap::from([("usr_stale".to_string(), "online".to_string())]);
    let fetched_friends_by_id = HashMap::new();

    let snapshot = build_fast_roster_snapshot(
        "usr_self",
        &expected_ids,
        &state_by_id,
        &fetched_friends_by_id,
    );

    let friends_by_id = snapshot
        .get("friendsById")
        .and_then(Value::as_object)
        .expect("friendsById object");
    let stale = friends_by_id.get("usr_stale").expect("usr_stale present");
    assert_eq!(
        object_field(stale, "stateBucket").and_then(Value::as_str),
        Some("online")
    );
    assert_eq!(
        object_field(stale, "$profileSource").and_then(Value::as_str),
        Some("placeholder")
    );
}

#[test]
fn placeholder_active_friend_is_kept_active() {
    let expected_ids = vec!["usr_active".to_string()];
    let state_by_id = HashMap::from([("usr_active".to_string(), "active".to_string())]);
    let fetched_friends_by_id = HashMap::new();

    let snapshot = build_fast_roster_snapshot(
        "usr_self",
        &expected_ids,
        &state_by_id,
        &fetched_friends_by_id,
    );

    let friends_by_id = snapshot
        .get("friendsById")
        .and_then(Value::as_object)
        .expect("friendsById object");
    let active = friends_by_id.get("usr_active").expect("usr_active present");
    assert_eq!(
        object_field(active, "stateBucket").and_then(Value::as_str),
        Some("active")
    );
    assert_eq!(
        snapshot
            .get("activeIds")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        vec![json!("usr_active")]
    );
}

#[test]
fn online_friend_in_private_world_stays_online() {
    let expected_ids = vec!["usr_priv".to_string()];
    let state_by_id = HashMap::from([("usr_priv".to_string(), "online".to_string())]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_priv".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_priv",
                "displayName": "Priv",
                "location": "private",
                "status": "ask me"
            }),
            Some("online"),
        )
        .expect("valid profile"),
    )]);

    let snapshot = build_fast_roster_snapshot(
        "usr_self",
        &expected_ids,
        &state_by_id,
        &fetched_friends_by_id,
    );

    let friends_by_id = snapshot
        .get("friendsById")
        .and_then(Value::as_object)
        .expect("friendsById object");
    let priv_friend = friends_by_id.get("usr_priv").expect("usr_priv present");
    assert_eq!(
        object_field(priv_friend, "stateBucket").and_then(Value::as_str),
        Some("online")
    );
}

#[test]
fn list_bucket_decides_state_not_location() {
    let expected_ids = vec!["usr_inworld".to_string()];
    let state_by_id = HashMap::from([("usr_inworld".to_string(), "offline".to_string())]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_inworld".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_inworld",
                "displayName": "InWorld",
                "location": "wrld_1b754e93:1",
                "status": "join me"
            }),
            Some("offline"),
        )
        .expect("valid profile"),
    )]);

    let snapshot = build_fast_roster_snapshot(
        "usr_self",
        &expected_ids,
        &state_by_id,
        &fetched_friends_by_id,
    );

    let friends_by_id = snapshot
        .get("friendsById")
        .and_then(Value::as_object)
        .expect("friendsById object");
    let friend = friends_by_id
        .get("usr_inworld")
        .expect("usr_inworld present");
    assert_eq!(
        object_field(friend, "stateBucket").and_then(Value::as_str),
        Some("offline")
    );
}

#[test]
fn active_list_bucket_ignores_location() {
    let expected_ids = vec!["usr_active_inworld".to_string()];
    let state_by_id = HashMap::from([("usr_active_inworld".to_string(), "active".to_string())]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_active_inworld".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_active_inworld",
                "displayName": "ActiveInWorld",
                "location": "wrld_929c02a8:1",
                "status": "join me"
            }),
            Some("active"),
        )
        .expect("valid profile"),
    )]);

    let snapshot = build_fast_roster_snapshot(
        "usr_self",
        &expected_ids,
        &state_by_id,
        &fetched_friends_by_id,
    );

    let friends_by_id = snapshot
        .get("friendsById")
        .and_then(Value::as_object)
        .expect("friendsById object");
    let friend = friends_by_id
        .get("usr_active_inworld")
        .expect("usr_active_inworld present");
    assert_eq!(
        object_field(friend, "stateBucket").and_then(Value::as_str),
        Some("active")
    );
}
