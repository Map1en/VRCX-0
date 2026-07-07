use super::test_support::*;
use super::*;

#[test]
fn notification_cache_hits_enrich_projection_and_persistence() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("notification-cache-hit")?;
    world_cache_upsert(
        runtime.deps.db.as_ref(),
        cached_world_entry("wrld_cached", "Cached World", "2026-01-01T00:00:00.000Z"),
    )?;
    runtime.world_cache.init_load();
    runtime.ingest_user_facts(vec![json!({
        "user": {
            "id": "usr_sender",
            "displayName": "Cached Sender"
        },
        "source": "test",
        "isFriend": false
    })]);
    runtime.deps.event_bus.take_events_for_test();
    let notification = json!({
        "id": "notif-cache-hit",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "invite",
        "senderUserId": "usr_sender",
        "senderUsername": "usr_sender",
        "message": "Join me",
        "details": {
            "worldId": "wrld_cached",
            "worldName": "wrld_cached"
        }
    });

    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id.clone(),
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: notification.clone(),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: false,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![notification],
            ..RealtimePersistenceBatch::default()
        },
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeNotificationProjection")
        .expect("cache-hit notification should emit a realtime projection");
    let projected = &projection.payload["upserts"][0]["notification"];
    assert_eq!(projected["senderDisplayName"], "Cached Sender");
    assert_eq!(projected["senderUsername"], "Cached Sender");
    assert_eq!(projected["details"]["worldName"], "Cached World");

    let rows = notification_list_query(
        runtime.deps.db.as_ref(),
        NotificationListQueryInput {
            user_id: active_session.user_id,
            search: String::new(),
            filters: Vec::new(),
            per_table_limit: 10,
            limit: 10,
            include_unseen: false,
        },
    )?;
    let row = rows
        .iter()
        .find(|row| row.id == "notif-cache-hit")
        .expect("notification should be persisted");
    assert_eq!(row.sender_username, "Cached Sender");
    assert_eq!(row.details["worldName"], "Cached World");
    Ok(())
}

#[test]
fn notification_cache_hit_enriches_avatar_image_for_runtime_delivery() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("notification-avatar-cache-hit")?;
    runtime.ingest_user_facts(vec![json!({
        "user": {
            "id": "usr_sender",
            "displayName": "Cached Sender",
            "userIcon": "https://images.example/user-icon.png",
            "profilePicOverride": "https://images.example/profile.png",
            "currentAvatarThumbnailImageUrl": "https://images.example/avatar-thumb.png"
        },
        "source": "test",
        "isFriend": false
    })]);
    runtime.deps.event_bus.take_events_for_test();
    let notification = json!({
        "id": "notif-avatar-cache-hit",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "friendRequest",
        "senderUserId": "usr_sender",
        "senderUsername": "usr_sender",
        "message": "Friend request"
    });

    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id.clone(),
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: notification.clone(),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: false,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![notification],
            ..RealtimePersistenceBatch::default()
        },
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeNotificationProjection")
        .expect("cache-hit notification should emit a realtime projection");
    let projected = &projection.payload["upserts"][0]["notification"];
    assert_eq!(
        projected["imageUrl"],
        "https://images.example/user-icon.png"
    );

    let entries = runtime.deps.overlay_activity.snapshot().entries;
    let entry = entries
        .iter()
        .find(|entry| entry.source_id == "notification:notif-avatar-cache-hit")
        .expect("runtime delivery should be projected to overlay activity");
    assert_eq!(
        entry.content.image_url,
        "https://images.example/user-icon.png"
    );
    Ok(())
}

#[test]
fn notification_avatar_resolves_from_user_id_when_sender_field_absent() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("notification-avatar-user-id")?;
    runtime.ingest_user_facts(vec![json!({
        "user": {
            "id": "usr_sender",
            "displayName": "Cached Sender",
            "userIcon": "https://images.example/user-icon.png",
            "profilePicOverride": "https://images.example/profile.png",
            "currentAvatarThumbnailImageUrl": "https://images.example/avatar-thumb.png"
        },
        "source": "test",
        "isFriend": false
    })]);
    runtime.deps.event_bus.take_events_for_test();
    let notification = json!({
        "id": "notif-avatar-user-id",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "friendRequest",
        "userId": "usr_sender",
        "senderUsername": "usr_sender",
        "message": "Friend request"
    });

    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id.clone(),
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: notification.clone(),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: false,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![notification],
            ..RealtimePersistenceBatch::default()
        },
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeNotificationProjection")
        .expect("user-id sender notification should emit a realtime projection");
    let projected = &projection.payload["upserts"][0]["notification"];
    assert_eq!(
        projected["imageUrl"],
        "https://images.example/user-icon.png"
    );
    Ok(())
}

#[test]
fn notification_avatar_fallback_skips_owner_receiver_when_sender_is_absent() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("notification-avatar-receiver")?;
    runtime.ingest_user_facts(vec![json!({
        "user": {
            "id": "usr_self",
            "displayName": "Self",
            "userIcon": "https://images.example/self-icon.png",
            "profilePicOverride": "https://images.example/self-profile.png",
            "currentAvatarThumbnailImageUrl": "https://images.example/self-avatar.png"
        },
        "source": "test",
        "isFriend": false
    })]);
    runtime.deps.event_bus.take_events_for_test();
    let notification = json!({
        "id": "notif-avatar-receiver",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "group.announcement",
        "receiverUserId": "usr_self",
        "userId": "usr_self",
        "message": "Group announcement"
    });

    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id.clone(),
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: notification.clone(),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: false,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![notification],
            ..RealtimePersistenceBatch::default()
        },
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeNotificationProjection")
        .expect("receiver-only notification should emit a realtime projection");
    let projected = &projection.payload["upserts"][0]["notification"];
    assert!(projected["imageUrl"].is_null());

    let entries = runtime.deps.overlay_activity.snapshot().entries;
    let entry = entries
        .iter()
        .find(|entry| entry.source_id == "notification:notif-avatar-receiver")
        .expect("runtime delivery should be projected to overlay activity");
    assert!(entry.actor_user_id.is_empty());
    assert!(entry.content.image_url.is_empty());
    Ok(())
}

#[test]
fn notification_avatar_fallback_skips_current_user_sender() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("notification-avatar-self-sender")?;
    runtime.ingest_user_facts(vec![json!({
        "user": {
            "id": "usr_self",
            "displayName": "Self",
            "userIcon": "https://images.example/self-icon.png",
            "profilePicOverride": "https://images.example/self-profile.png",
            "currentAvatarThumbnailImageUrl": "https://images.example/self-avatar.png"
        },
        "source": "test",
        "isFriend": false
    })]);
    runtime.deps.event_bus.take_events_for_test();
    let notification = json!({
        "id": "notif-avatar-self-sender",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "friendRequest",
        "senderUserId": "usr_self",
        "senderUsername": "Self",
        "message": "Friend request"
    });

    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id,
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: notification.clone(),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: false,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![notification],
            ..RealtimePersistenceBatch::default()
        },
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeNotificationProjection")
        .expect("self-sender notification should emit a realtime projection");
    let projected = &projection.payload["upserts"][0]["notification"];
    assert!(projected["imageUrl"].is_null());

    let entries = runtime.deps.overlay_activity.snapshot().entries;
    let entry = entries
        .iter()
        .find(|entry| entry.source_id == "notification:notif-avatar-self-sender")
        .expect("runtime delivery should be projected to overlay activity");
    assert_eq!(entry.actor_user_id, "usr_self");
    assert!(entry.content.image_url.is_empty());
    Ok(())
}

#[test]
fn notification_avatar_fallback_respects_vrc_plus_icon_preference() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("notification-avatar-vrc-plus-disabled")?;
    config_store::set_bool(
        runtime.deps.db.as_ref(),
        "displayVRCPlusIconsAsAvatar",
        false,
    )?;
    runtime.ingest_user_facts(vec![json!({
        "user": {
            "id": "usr_sender",
            "displayName": "Cached Sender",
            "userIcon": "https://images.example/user-icon.png",
            "profilePicOverride": "https://images.example/profile.png",
            "currentAvatarThumbnailImageUrl": "https://images.example/avatar-thumb.png"
        },
        "source": "test",
        "isFriend": false
    })]);
    runtime.deps.event_bus.take_events_for_test();
    let notification = json!({
        "id": "notif-avatar-vrc-plus-disabled",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "friendRequest",
        "senderUserId": "usr_sender",
        "senderUsername": "usr_sender",
        "message": "Friend request"
    });

    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id,
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: notification.clone(),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: false,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![notification],
            ..RealtimePersistenceBatch::default()
        },
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeNotificationProjection")
        .expect("cache-hit notification should emit a realtime projection");
    let projected = &projection.payload["upserts"][0]["notification"];
    assert_eq!(projected["imageUrl"], "https://images.example/profile.png");
    Ok(())
}

#[test]
fn notification_avatar_fallback_preserves_existing_image_and_skips_group_sender() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("notification-avatar-existing-and-group")?;
    runtime.ingest_user_facts(vec![json!({
        "user": {
            "id": "usr_sender",
            "displayName": "Cached Sender",
            "userIcon": "https://images.example/user-icon.png",
            "currentAvatarThumbnailImageUrl": "https://images.example/avatar-thumb.png"
        },
        "source": "test",
        "isFriend": false
    })]);
    runtime.deps.event_bus.take_events_for_test();
    let existing_image = json!({
        "id": "notif-avatar-existing",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "friendRequest",
        "senderUserId": "usr_sender",
        "senderUsername": "Cached Sender",
        "message": "Friend request",
        "imageUrl": "https://images.example/existing.png"
    });
    let group_sender = json!({
        "id": "notif-avatar-group",
        "createdAt": "2026-06-21T00:00:01.000Z",
        "type": "friendRequest",
        "senderUserId": "grp_sender",
        "senderUsername": "Group Sender",
        "message": "Group request"
    });

    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id,
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![
                RealtimeNotificationUpsert {
                    notification: existing_image.clone(),
                    insert_defaults: None,
                    notify_menu: true,
                    deliver_runtime: true,
                    run_automation: false,
                },
                RealtimeNotificationUpsert {
                    notification: group_sender.clone(),
                    insert_defaults: None,
                    notify_menu: true,
                    deliver_runtime: true,
                    run_automation: false,
                },
            ],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![existing_image, group_sender],
            ..RealtimePersistenceBatch::default()
        },
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeNotificationProjection")
        .expect("notifications should emit a realtime projection");
    let upserts = projection.payload["upserts"]
        .as_array()
        .expect("projection upserts");
    let existing = upserts
        .iter()
        .find(|upsert| upsert["notification"]["id"] == "notif-avatar-existing")
        .expect("existing image notification");
    let group = upserts
        .iter()
        .find(|upsert| upsert["notification"]["id"] == "notif-avatar-group")
        .expect("group notification");
    assert_eq!(
        existing["notification"]["imageUrl"],
        "https://images.example/existing.png"
    );
    assert!(group["notification"]["imageUrl"].is_null());
    Ok(())
}

#[test]
fn unresolved_person_location_notification_persists_without_runtime_projection() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("notification-unresolved-basic")?;
    let notification = json!({
        "id": "notif-unresolved",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "invite",
        "senderUserId": "usr_missing",
        "senderUsername": "usr_missing",
        "message": "Join me",
        "details": {
            "worldId": "wrld_missing",
            "worldName": "wrld_missing"
        }
    });

    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id.clone(),
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: notification.clone(),
                insert_defaults: None,
                notify_menu: true,
                deliver_runtime: true,
                run_automation: true,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![notification],
            ..RealtimePersistenceBatch::default()
        },
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    assert!(
        events
            .iter()
            .all(|event| event.name != "realtimeNotificationProjection"),
        "unresolved notification should not be emitted to runtime/UI projection"
    );

    let rows = notification_list_query(
        runtime.deps.db.as_ref(),
        NotificationListQueryInput {
            user_id: active_session.user_id,
            search: String::new(),
            filters: Vec::new(),
            per_table_limit: 10,
            limit: 10,
            include_unseen: false,
        },
    )?;
    let row = rows
        .iter()
        .find(|row| row.id == "notif-unresolved")
        .expect("unresolved notification should still be persisted");
    assert_eq!(row.sender_user_id, "usr_missing");
    assert_eq!(row.sender_username, "");
    assert_eq!(row.details["worldId"], "wrld_missing");
    assert_eq!(row.details["worldName"], "");
    assert!(
        runtime
            .state
            .lock()
            .unwrap()
            .world_name_fetches
            .contains_key("wrld_missing"),
        "notification resolver failures should register async world warm"
    );
    Ok(())
}

#[test]
fn notification_v2_update_sanitizes_id_like_names_before_persistence() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("notification-update-sanitize")?;
    let initial = json!({
        "id": "notif-update-sanitize",
        "createdAt": "2026-06-21T00:00:00.000Z",
        "type": "invite",
        "senderUserId": "usr_sender",
        "senderUsername": "Sender",
        "message": "Join me",
        "details": {
            "worldId": "wrld_initial",
            "worldName": "Initial World"
        }
    });
    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id.clone(),
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: initial.clone(),
                insert_defaults: None,
                notify_menu: false,
                deliver_runtime: false,
                run_automation: false,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_upserts: vec![initial],
            ..RealtimePersistenceBatch::default()
        },
    });
    runtime.deps.event_bus.take_events_for_test();

    let update = json!({
        "id": "notif-update-sanitize",
        "senderUserId": "usr_missing",
        "senderUsername": "usr_missing",
        "details": {
            "worldId": "wrld_missing",
            "worldName": "wrld_missing"
        }
    });
    runtime.apply_notification_output(RealtimeNotificationOutput {
        owner_user_id: active_session.user_id.clone(),
        projection: RealtimeNotificationProjection {
            generation: 7,
            upserts: vec![RealtimeNotificationUpsert {
                notification: update.clone(),
                insert_defaults: Some(json!({
                    "createdAt": "2026-06-21T00:01:00.000Z",
                    "created_at": "2026-06-21T00:01:00.000Z",
                    "seen": false
                })),
                notify_menu: false,
                deliver_runtime: false,
                run_automation: false,
            }],
            ..RealtimeNotificationProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            notification_v2_updates: vec![NotificationV2Update {
                id: "notif-update-sanitize".into(),
                updates: update,
                received_at: "2026-06-21T00:01:00.000Z".into(),
            }],
            ..RealtimePersistenceBatch::default()
        },
    });

    let rows = notification_list_query(
        runtime.deps.db.as_ref(),
        NotificationListQueryInput {
            user_id: active_session.user_id,
            search: String::new(),
            filters: Vec::new(),
            per_table_limit: 10,
            limit: 10,
            include_unseen: false,
        },
    )?;
    let row = rows
        .iter()
        .find(|row| row.id == "notif-update-sanitize")
        .expect("notification update should be persisted");
    assert_eq!(row.sender_user_id, "usr_missing");
    assert_eq!(row.sender_username, "");
    assert_eq!(row.details["worldId"], "wrld_missing");
    assert_eq!(row.details["worldName"], "");
    Ok(())
}
