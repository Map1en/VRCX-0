use std::path::PathBuf;

use serde_json::json;

use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::game_log::GameLogLocationEntry;

use super::{
    normalize_user_table_prefix, write_realtime_batch, FriendLogDelete, FriendLogUpsert,
    NotificationV2Update, RealtimePersistenceBatch,
};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn normalizes_user_table_prefix_like_frontend() {
    assert_eq!(
        normalize_user_table_prefix("usr_123-abc").unwrap(),
        "usr123abc"
    );
    assert_eq!(normalize_user_table_prefix("123").unwrap(), "_123");
}

#[test]
fn rejects_empty_or_injection_user_table_prefix() {
    for user_id in [
        "",
        "   ",
        "usr_self;DROP TABLE usrself_feed_gps",
        "usr_self feed_gps",
        "usr_self.feed_gps",
        "usr_self/feed_gps",
    ] {
        assert!(
            normalize_user_table_prefix(user_id).is_err(),
            "{user_id:?} must not become a table prefix"
        );
    }
}

#[test]
fn writes_friend_log_and_feed_rows() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-persistence");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let counts = write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known".into(),
                friend_number: 12,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            feed_entries: vec![json!({
                "created_at": "2026-05-15T00:00:00Z",
                "type": "Online",
                "userId": "usr_friend",
                "displayName": "Friend",
                "location": "wrld_1:123",
                "worldName": "wrld_1",
                "time": 0,
                "groupName": ""
            })],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    assert_eq!(counts.affected_count, 3);
    assert_eq!(counts.game_log_affected_count, 0);

    let current = db.execute(
        "SELECT user_id, display_name, trust_level, friend_number FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][1], json!("Friend"));
    assert_eq!(current[0][3], json!(12));
    let feed = db.execute(
        "SELECT user_id, type, location FROM usrself_feed_online_offline WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(feed[0][1], json!("Online"));
    assert_eq!(feed[0][2], json!("wrld_1:123"));

    let location_counts = write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            game_log_locations: vec![GameLogLocationEntry {
                created_at: "2026-05-15T00:00:05Z".into(),
                location: "wrld_1:123".into(),
                world_id: "wrld_1".into(),
                world_name: "World".into(),
                time: 0,
                group_name: "".into(),
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    assert_eq!(location_counts.affected_count, 1);
    assert_eq!(location_counts.game_log_affected_count, 1);
    Ok(())
}

#[test]
fn friend_and_unfriend_feed_markers_are_skipped_not_persisted_as_feed_rows(
) -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-friend-unfriend-feed-marker");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            feed_entries: vec![json!({
                "created_at": "2026-05-15T00:00:00Z",
                "type": "Friend",
                "userId": "usr_friend",
                "displayName": "Friend",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let friend_history = db.execute(
        "SELECT type FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'Friend'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(friend_history.len(), 1);

    write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            friend_log_deletes: vec![FriendLogDelete {
                target_user_id: "usr_friend".into(),
                created_at: "2026-05-15T00:00:01Z".into(),
            }],
            feed_entries: vec![json!({
                "created_at": "2026-05-15T00:00:01Z",
                "type": "Unfriend",
                "userId": "usr_friend",
                "displayName": "Friend",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let current = db.execute(
        "SELECT user_id FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert!(current.is_empty());
    let unfriend_history = db.execute(
        "SELECT type FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'Unfriend'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(unfriend_history.len(), 1);
    Ok(())
}

#[test]
fn force_history_false_skips_friend_history_on_update() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-force-history-false");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let upsert = |name: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: "Known".into(),
            friend_number: 12,
            created_at: "2026-05-15T00:00:00Z".into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(&db, "usr_self", &upsert("Friend"))?;
    write_realtime_batch(&db, "usr_self", &upsert("Friend Renamed"))?;

    let history = db.execute(
        "SELECT user_id FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'Friend'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(history.len(), 1);
    Ok(())
}

#[test]
fn display_name_change_on_update_writes_display_name_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-display-name-change");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let upsert = |name: &str, trust: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: trust.into(),
            friend_number: 12,
            created_at: "2026-05-15T00:00:00Z".into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(&db, "usr_self", &upsert("Friend", "Known"))?;
    write_realtime_batch(&db, "usr_self", &upsert("Friend Renamed", ""))?;

    let history = db.execute(
        "SELECT display_name, previous_display_name FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'DisplayName'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0][0], json!("Friend Renamed"));
    assert_eq!(history[0][1], json!("Friend"));

    let current = db.execute(
        "SELECT display_name, trust_level FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][0], json!("Friend Renamed"));
    assert_eq!(current[0][1], json!("Known"));
    Ok(())
}

#[test]
fn trust_change_on_update_writes_trust_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-trust-change");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let upsert = |name: &str, trust: &str, created_at: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: trust.into(),
            friend_number: 12,
            created_at: created_at.into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(
        &db,
        "usr_self",
        &upsert("Friend", "Known User", "2026-05-15T00:00:00Z"),
    )?;
    write_realtime_batch(
        &db,
        "usr_self",
        &upsert("Friend", "Trusted User", "2026-05-15T00:00:01Z"),
    )?;

    let history = db.execute(
        "SELECT display_name, trust_level, previous_trust_level, friend_number FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'TrustLevel'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0][0], json!("Friend"));
    assert_eq!(history[0][1], json!("Trusted User"));
    assert_eq!(history[0][2], json!("Known User"));
    assert_eq!(history[0][3], json!(12));
    Ok(())
}

#[test]
fn simultaneous_name_and_trust_change_writes_both_histories() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-name-trust-change");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let batch = |name: &str, trust: &str, created_at: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: trust.into(),
            friend_number: 12,
            created_at: created_at.into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(
        &db,
        "usr_self",
        &batch("Old Name", "Known User", "2026-05-15T00:00:00Z"),
    )?;
    write_realtime_batch(
        &db,
        "usr_self",
        &batch("New Name", "Trusted User", "2026-05-15T00:00:01Z"),
    )?;

    let history = db.execute(
        "SELECT type FROM usrself_friend_log_history WHERE user_id = @user_id AND type IN ('DisplayName', 'TrustLevel') ORDER BY type",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(
        history,
        vec![vec![json!("DisplayName")], vec![json!("TrustLevel")]]
    );
    Ok(())
}

#[test]
fn empty_same_and_legacy_equivalent_trust_values_skip_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-trust-skip");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let batch = |trust: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: "Friend".into(),
            trust_level: trust.into(),
            friend_number: 12,
            created_at: "2026-05-15T00:00:00Z".into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(&db, "usr_self", &batch("Trusted User"))?;
    write_realtime_batch(&db, "usr_self", &batch(""))?;
    write_realtime_batch(&db, "usr_self", &batch("Trusted User"))?;
    write_realtime_batch(&db, "usr_self", &batch("Veteran User"))?;

    let history = db.execute(
        "SELECT trust_level FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'TrustLevel'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    let current = db.execute(
        "SELECT trust_level FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert!(history.is_empty());
    assert_eq!(current[0][0], json!("Veteran User"));
    Ok(())
}

#[test]
fn failed_trust_batch_rolls_back_current_and_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-trust-rollback");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known User".into(),
                friend_number: 12,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let result = write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Trusted User".into(),
                friend_number: 12,
                created_at: "2026-05-15T00:00:01Z".into(),
                force_history: false,
            }],
            feed_entries: vec![json!({
                "created_at": "2026-05-15T00:00:01Z",
                "type": "InvalidTrustFeed"
            })],
            ..RealtimePersistenceBatch::default()
        },
    );
    assert!(result.is_err());

    let current = db.execute(
        "SELECT trust_level FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    let history = db.execute(
        "SELECT trust_level FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'TrustLevel'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][0], json!("Known User"));
    assert!(history.is_empty());
    Ok(())
}

#[test]
fn unchanged_or_unknown_display_name_skips_display_name_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-display-name-skip");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let upsert = |name: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: "Known".into(),
            friend_number: 12,
            created_at: "2026-05-15T00:00:00Z".into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(&db, "usr_self", &upsert(""))?;
    write_realtime_batch(&db, "usr_self", &upsert("First Known Name"))?;
    write_realtime_batch(&db, "usr_self", &upsert("First Known Name"))?;
    write_realtime_batch(&db, "usr_self", &upsert(""))?;
    write_realtime_batch(&db, "usr_self", &upsert("Unknown"))?;

    let history = db.execute(
        "SELECT display_name FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'DisplayName'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert!(history.is_empty());

    let current = db.execute(
        "SELECT display_name FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][0], json!("First Known Name"));
    Ok(())
}

#[test]
fn blank_display_name_persists_unknown_not_user_id() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-unknown-display-name");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: String::new(),
                trust_level: "Known".into(),
                friend_number: 12,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let current = db.execute(
        "SELECT display_name FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][0], json!("Unknown"));
    Ok(())
}

#[test]
fn rejects_invalid_realtime_feed_entry_type() {
    let dir = TestDir::new("realtime-invalid-feed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();

    let error = write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            feed_entries: vec![json!({
                "created_at": "2026-05-15T00:00:00Z",
                "type": "UnknownFeedType",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();

    assert!(matches!(error, crate::Error::InvalidData(_)));
}

#[test]
fn rejects_trust_feed_without_matching_friend_log_upsert() {
    let dir = TestDir::new("realtime-unpaired-trust-feed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();

    let error = write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            feed_entries: vec![json!({
                "created_at": "2026-05-15T00:00:00Z",
                "type": "TrustLevel",
                "userId": "usr_friend",
                "displayName": "Friend",
                "trustLevel": "Trusted User",
                "previousTrustLevel": "Known User",
                "friendNumber": 7
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();

    assert!(matches!(error, crate::Error::InvalidData(_)));
}

#[test]
fn rolls_back_friend_log_rows_when_later_feed_entry_fails() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-rollback-feed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let error = write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            feed_entries: vec![json!({
                "created_at": "2026-05-15T00:00:01Z",
                "type": "NewFeedType",
                "userId": "usr_friend",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();
    assert!(matches!(error, crate::Error::InvalidData(_)));

    let current = db.execute(
        "SELECT COUNT(*) FROM usrself_friend_log_current",
        &Default::default(),
    )?;
    let history = db.execute(
        "SELECT COUNT(*) FROM usrself_friend_log_history",
        &Default::default(),
    )?;
    assert_eq!(current[0][0], json!(0));
    assert_eq!(history[0][0], json!(0));
    Ok(())
}

#[test]
fn writes_notification_v1_and_v2_schema_columns() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-notification-columns");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            notification_v1_upserts: vec![json!({
                "id": "notif_v1",
                "createdAt": "2026-05-15T00:00:00Z",
                "type": "invite",
                "senderUserId": "usr_sender",
                "senderUsername": "Sender",
                "receiverUserId": "usr_self",
                "message": "Join me",
                "imageUrl": "https://images.example/fallback.png",
                "$isExpired": true,
                "details": {
                    "worldId": "wrld_invite",
                    "worldName": "Invite World",
                    "imageUrl": "https://images.example/details.png",
                    "inviteMessage": "Invite text",
                    "requestMessage": "Request text",
                    "responseMessage": "Response text"
                }
            })],
            notification_v2_upserts: vec![json!({
                "id": "notif_v2",
                "createdAt": "2026-05-15T00:01:00Z",
                "updatedAt": "2026-05-15T00:01:01Z",
                "expiresAt": "2026-05-16T00:01:00Z",
                "type": "friendRequest",
                "link": "https://vrchat.com/home/user/usr_sender",
                "linkText": "Open user",
                "message": "Add me",
                "title": "Friend request",
                "imageUrl": "https://images.example/v2.png",
                "seen": true,
                "senderUserId": "usr_sender_v2",
                "senderUsername": "Sender Two",
                "data": { "groupName": "Group Alpha" },
                "responses": [{ "type": "accept" }],
                "details": { "worldId": "wrld_v2", "worldName": "V2 World" }
            })],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let v1 = db.execute(
        concat!(
            "SELECT created_at, type, sender_user_id, sender_username, receiver_user_id, ",
            "message, world_id, world_name, image_url, invite_message, request_message, ",
            "response_message, expired FROM usrself_notifications WHERE id = @id"
        ),
        &ParamsBuilder::new().set("id", "notif_v1").build(),
    )?;
    assert_eq!(v1[0][0], json!("2026-05-15T00:00:00Z"));
    assert_eq!(v1[0][1], json!("invite"));
    assert_eq!(v1[0][2], json!("usr_sender"));
    assert_eq!(v1[0][3], json!("Sender"));
    assert_eq!(v1[0][4], json!("usr_self"));
    assert_eq!(v1[0][5], json!("Join me"));
    assert_eq!(v1[0][6], json!("wrld_invite"));
    assert_eq!(v1[0][7], json!("Invite World"));
    assert_eq!(v1[0][8], json!("https://images.example/details.png"));
    assert_eq!(v1[0][9], json!("Invite text"));
    assert_eq!(v1[0][10], json!("Request text"));
    assert_eq!(v1[0][11], json!("Response text"));
    assert_eq!(v1[0][12], json!(1));

    let v2 = db.execute(
        concat!(
            "SELECT created_at, updated_at, expires_at, type, link, link_text, message, ",
            "title, image_url, seen, sender_user_id, sender_username, data, responses, ",
            "details FROM usrself_notifications_v2 WHERE id = @id"
        ),
        &ParamsBuilder::new().set("id", "notif_v2").build(),
    )?;
    assert_eq!(v2[0][0], json!("2026-05-15T00:01:00Z"));
    assert_eq!(v2[0][1], json!("2026-05-15T00:01:01Z"));
    assert_eq!(v2[0][2], json!("2026-05-16T00:01:00Z"));
    assert_eq!(v2[0][3], json!("friendRequest"));
    assert_eq!(v2[0][4], json!("https://vrchat.com/home/user/usr_sender"));
    assert_eq!(v2[0][5], json!("Open user"));
    assert_eq!(v2[0][6], json!("Add me"));
    assert_eq!(v2[0][7], json!("Friend request"));
    assert_eq!(v2[0][8], json!("https://images.example/v2.png"));
    assert_eq!(v2[0][9], json!(1));
    assert_eq!(v2[0][10], json!("usr_sender_v2"));
    assert_eq!(v2[0][11], json!("Sender Two"));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(v2[0][12].as_str().unwrap())?,
        json!({ "groupName": "Group Alpha" })
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(v2[0][13].as_str().unwrap())?,
        json!([{ "type": "accept" }])
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(v2[0][14].as_str().unwrap())?,
        json!({ "worldId": "wrld_v2", "worldName": "V2 World" })
    );
    Ok(())
}

#[test]
fn notification_v2_update_falls_back_to_upsert_with_received_timestamp() -> Result<(), crate::Error>
{
    let dir = TestDir::new("realtime-notification-update-fallback");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            notification_v2_updates: vec![NotificationV2Update {
                id: "notif_update".into(),
                received_at: "2026-05-15T00:02:00Z".into(),
                updates: json!({
                    "type": "invite",
                    "message": "Fallback insert",
                    "seen": true,
                    "data": { "groupName": "Inserted" },
                    "responses": [],
                    "details": { "worldId": "wrld_inserted" }
                }),
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let inserted = db.execute(
        concat!(
            "SELECT created_at, type, message, seen, data, details ",
            "FROM usrself_notifications_v2 WHERE id = @id"
        ),
        &ParamsBuilder::new().set("id", "notif_update").build(),
    )?;
    assert_eq!(inserted[0][0], json!("2026-05-15T00:02:00Z"));
    assert_eq!(inserted[0][1], json!("invite"));
    assert_eq!(inserted[0][2], json!("Fallback insert"));
    assert_eq!(inserted[0][3], json!(1));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(inserted[0][4].as_str().unwrap())?,
        json!({ "groupName": "Inserted" })
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(inserted[0][5].as_str().unwrap())?,
        json!({ "worldId": "wrld_inserted" })
    );
    Ok(())
}

#[test]
fn rejects_notifications_missing_required_fields() {
    let dir = TestDir::new("realtime-invalid-notification");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();

    let v1_error = write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            notification_v1_upserts: vec![json!({
                "id": "not_1",
                "createdAt": "2026-05-15T00:00:00Z",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();
    assert!(matches!(v1_error, crate::Error::InvalidData(_)));

    let v2_error = write_realtime_batch(
        &db,
        "usr_self",
        &RealtimePersistenceBatch {
            notification_v2_upserts: vec![json!({
                "id": "not_2",
                "type": "invite",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();
    assert!(matches!(v2_error, crate::Error::InvalidData(_)));
}
