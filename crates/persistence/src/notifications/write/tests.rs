use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde_json::{json, Value};

use crate::common::ParamsBuilder;
use crate::database::DatabaseService;

use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-notification-write-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_db(name: &str) -> Result<(TestDir, DatabaseService), Error> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    Ok((dir, db))
}

fn rows_by_id(db: &DatabaseService, sql: &str, id: &str) -> Result<Vec<Vec<Value>>, Error> {
    db.execute(sql, &ParamsBuilder::new().set("id", id).build())
}

fn add_version_pair(db: &DatabaseService, user_id: &str, id: &str) -> Result<(), Error> {
    notification_add_v1(
        db,
        user_id.to_string(),
        json!({
            "id": id,
            "created_at": "2026-05-15T00:00:00Z",
            "type": "invite",
            "message": "Legacy invite"
        }),
    )?;
    notification_add_v2(
        db,
        user_id.to_string(),
        json!({
            "id": id,
            "createdAt": "2026-05-15T00:01:00Z",
            "type": "invite",
            "message": "Current invite"
        }),
    )
}

#[test]
fn notification_add_v1_maps_legacy_fields_and_preserves_the_first_insert() -> Result<(), Error> {
    let (_dir, db) = test_db("v1-insert")?;

    notification_add_v1(
        &db,
        "usr_self".into(),
        json!({
            "id": " notif_v1 ",
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
        }),
    )?;
    notification_add_v1(
        &db,
        "usr_self".into(),
        json!({
            "id": "notif_v1",
            "created_at": "2026-05-16T00:00:00Z",
            "type": "friendRequest",
            "message": "Replacement must be ignored"
        }),
    )?;
    notification_add_v1(
        &db,
        "usr_self".into(),
        json!({
            "id": "notif_fallback",
            "created_at": "2026-05-16T00:01:00Z",
            "type": "invite",
            "imageUrl": "https://images.example/fallback.png"
        }),
    )?;

    let rows = rows_by_id(
        &db,
        concat!(
            "SELECT created_at, type, sender_user_id, sender_username, receiver_user_id, ",
            "message, world_id, world_name, image_url, invite_message, request_message, ",
            "response_message, expired, seen FROM usrself_notifications WHERE id = @id"
        ),
        "notif_v1",
    )?;
    assert_eq!(
        rows,
        vec![vec![
            json!("2026-05-15T00:00:00Z"),
            json!("invite"),
            json!("usr_sender"),
            json!("Sender"),
            json!("usr_self"),
            json!("Join me"),
            json!("wrld_invite"),
            json!("Invite World"),
            json!("https://images.example/details.png"),
            json!("Invite text"),
            json!("Request text"),
            json!("Response text"),
            json!(1),
            json!(1),
        ]]
    );
    let fallback = rows_by_id(
        &db,
        "SELECT image_url FROM usrself_notifications WHERE id = @id",
        "notif_fallback",
    )?;
    assert_eq!(fallback[0][0], json!("https://images.example/fallback.png"));

    let error = notification_add_v1(
        &db,
        "usr_self".into(),
        json!({
            "id": "missing_type",
            "created_at": "2026-05-15T00:00:00Z"
        }),
    )
    .unwrap_err();
    assert!(matches!(error, Error::Custom(_)));
    let blank_id_error = notification_add_v1(
        &db,
        "usr_self".into(),
        json!({
            "id": "   ",
            "created_at": "2026-05-15T00:00:00Z",
            "type": "invite"
        }),
    )
    .unwrap_err();
    assert!(matches!(blank_id_error, Error::Custom(_)));
    Ok(())
}

#[test]
fn friend_request_sync_reconciles_complete_remote_lists_and_revives_current_rows(
) -> Result<(), Error> {
    let (_dir, db) = test_db("friend-request-sync")?;
    for (id, type_name) in [
        ("stale-visible", "friendRequest"),
        ("current-visible", "friendRequest"),
        ("stale-hidden", "ignoredFriendRequest"),
    ] {
        notification_add_v1(
            &db,
            "usr_self".into(),
            json!({
                "id": id,
                "createdAt": "2026-05-15T00:00:00Z",
                "type": type_name,
                "message": "stale",
                "$isExpired": true
            }),
        )?;
    }

    notification_friend_requests_sync(
        &db,
        "usr_self".into(),
        vec![json!({
            "id": "current-visible",
            "createdAt": "2026-05-16T00:00:00Z",
            "type": "friendRequest",
            "message": "current"
        })],
        true,
        vec![json!({
            "id": "current-hidden",
            "createdAt": "2026-05-17T00:00:00Z",
            "type": "ignoredFriendRequest",
            "message": "hidden"
        })],
        true,
    )?;

    let rows = db.execute(
        concat!(
            "SELECT id, type, message, expired FROM usrself_notifications ",
            "WHERE type IN ('friendRequest', 'ignoredFriendRequest') ORDER BY id"
        ),
        &Default::default(),
    )?;
    assert_eq!(
        rows,
        vec![
            vec![
                json!("current-hidden"),
                json!("ignoredFriendRequest"),
                json!("hidden"),
                json!(0)
            ],
            vec![
                json!("current-visible"),
                json!("friendRequest"),
                json!("current"),
                json!(0)
            ],
            vec![
                json!("stale-hidden"),
                json!("ignoredFriendRequest"),
                json!("stale"),
                json!(1)
            ],
            vec![
                json!("stale-visible"),
                json!("friendRequest"),
                json!("stale"),
                json!(1)
            ],
        ]
    );
    Ok(())
}

#[test]
fn friend_request_sync_keeps_missing_rows_when_remote_pages_are_truncated() -> Result<(), Error> {
    let (_dir, db) = test_db("friend-request-sync-truncated")?;
    notification_add_v1(
        &db,
        "usr_self".into(),
        json!({
            "id": "possibly-unfetched",
            "createdAt": "2026-05-15T00:00:00Z",
            "type": "friendRequest"
        }),
    )?;

    notification_friend_requests_sync(
        &db,
        "usr_self".into(),
        Vec::new(),
        false,
        Vec::new(),
        false,
    )?;

    let rows = rows_by_id(
        &db,
        "SELECT expired FROM usrself_notifications WHERE id = @id",
        "possibly-unfetched",
    )?;
    assert_eq!(rows[0][0], json!(0));
    Ok(())
}

#[test]
fn notification_add_v2_accepts_aliases_defaults_json_and_replaces_existing_rows(
) -> Result<(), Error> {
    let (_dir, db) = test_db("v2-replace")?;

    notification_add_v2(
        &db,
        "usr_self".into(),
        json!({
            "id": " notif_v2 ",
            "createdAt": "2026-05-15T00:01:00Z",
            "updatedAt": "2026-05-15T00:02:00Z",
            "expiresAt": "2026-05-16T00:01:00Z",
            "type": "friendRequest",
            "link": "https://vrchat.com/home/user/usr_sender",
            "linkText": "Open user",
            "message": "Add me",
            "title": "Friend request",
            "imageUrl": "https://images.example/v2.png",
            "seen": true,
            "senderUserId": "usr_sender",
            "senderUsername": "Sender",
            "data": { "groupName": "Group Alpha" },
            "responses": [{ "type": "accept" }],
            "details": { "worldId": "wrld_v2" }
        }),
    )?;
    notification_add_v2(
        &db,
        "usr_self".into(),
        json!({
            "id": "notif_v2",
            "created_at": "2026-05-17T00:01:00Z",
            "updated_at": "2026-05-17T00:02:00Z",
            "expires_at": "2026-05-18T00:01:00Z",
            "type": "invite",
            "link_text": "Open world",
            "message": "Replacement",
            "image_url": "https://images.example/replacement.png",
            "sender_user_id": "usr_replacement",
            "sender_username": "Replacement Sender"
        }),
    )?;

    let rows = rows_by_id(
        &db,
        concat!(
            "SELECT created_at, updated_at, expires_at, type, link, link_text, message, title, ",
            "image_url, seen, sender_user_id, sender_username, data, responses, details ",
            "FROM usrself_notifications_v2 WHERE id = @id"
        ),
        "notif_v2",
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0][0], json!("2026-05-17T00:01:00Z"));
    assert_eq!(rows[0][1], json!("2026-05-17T00:02:00Z"));
    assert_eq!(rows[0][2], json!("2026-05-18T00:01:00Z"));
    assert_eq!(rows[0][3], json!("invite"));
    assert_eq!(rows[0][4], Value::Null);
    assert_eq!(rows[0][5], json!("Open world"));
    assert_eq!(rows[0][6], json!("Replacement"));
    assert_eq!(rows[0][7], Value::Null);
    assert_eq!(rows[0][8], json!("https://images.example/replacement.png"));
    assert_eq!(rows[0][9], json!(1));
    assert_eq!(rows[0][10], json!("usr_replacement"));
    assert_eq!(rows[0][11], json!("Replacement Sender"));
    assert_eq!(
        serde_json::from_str::<Value>(rows[0][12].as_str().unwrap())?,
        json!({})
    );
    assert_eq!(
        serde_json::from_str::<Value>(rows[0][13].as_str().unwrap())?,
        json!([])
    );
    assert_eq!(
        serde_json::from_str::<Value>(rows[0][14].as_str().unwrap())?,
        json!({})
    );

    let count = db.execute(
        "SELECT COUNT(*) FROM usrself_notifications_v2",
        &Default::default(),
    )?;
    assert_eq!(count[0][0], json!(1));

    notification_add_v2(&db, "usr_self".into(), json!({ "id": "   " }))?;
    let blank = db.execute(
        "SELECT COUNT(*) FROM usrself_notifications_v2 WHERE TRIM(id) = ''",
        &Default::default(),
    )?;
    assert_eq!(blank[0][0], json!(0));
    Ok(())
}

#[test]
fn notification_mutations_update_only_the_requested_rows() -> Result<(), Error> {
    let (_dir, db) = test_db("mutations")?;
    for id in ["first", "second", "third"] {
        notification_add_v2(
            &db,
            "usr_self".into(),
            json!({
                "id": id,
                "createdAt": "2026-05-15T00:01:00Z",
                "seen": false
            }),
        )?;
    }
    notification_add_v1(
        &db,
        "usr_self".into(),
        json!({
            "id": "legacy",
            "created_at": "2026-05-15T00:00:00Z",
            "type": "invite",
            "$isExpired": true
        }),
    )?;

    notification_v2_mark_seen(&db, "usr_self".into(), " first ".into())?;
    notification_mark_read_bulk(
        &db,
        "usr_self".into(),
        [" second ", "", "missing"]
            .into_iter()
            .map(|id| NotificationRead {
                id: id.into(),
                version: 2,
                expire: false,
            })
            .collect(),
    )?;
    let before = Utc::now();
    notification_v2_expire(&db, "usr_self".into(), " third ".into())?;
    let after = Utc::now();
    notification_update_expired(&db, "usr_self".into(), " legacy ".into(), false)?;

    let v2 = db.execute(
        "SELECT id, expires_at, seen FROM usrself_notifications_v2 ORDER BY id",
        &Default::default(),
    )?;
    assert_eq!(v2[0], vec![json!("first"), Value::Null, json!(1)]);
    assert_eq!(v2[1], vec![json!("second"), Value::Null, json!(1)]);
    assert_eq!(v2[2][0], json!("third"));
    assert_eq!(v2[2][2], json!(1));
    let expires_at = DateTime::parse_from_rfc3339(v2[2][1].as_str().unwrap())
        .unwrap()
        .with_timezone(&Utc);
    assert!(expires_at.timestamp_millis() >= before.timestamp_millis());
    assert!(expires_at.timestamp_millis() <= after.timestamp_millis());

    let legacy = rows_by_id(
        &db,
        "SELECT expired FROM usrself_notifications WHERE id = @id",
        "legacy",
    )?;
    assert_eq!(legacy[0][0], json!(0));
    Ok(())
}

#[test]
fn expiring_a_v1_notification_marks_it_seen() -> Result<(), Error> {
    let (_dir, db) = test_db("notification-v1-expired-seen")?;
    for id in ["flagged", "expired"] {
        notification_add_v1(
            &db,
            "usr_self".into(),
            json!({
                "id": id,
                "created_at": "2026-05-15T00:00:00Z",
                "type": "friendRequest"
            }),
        )?;
    }

    notification_update_expired(&db, "usr_self".into(), "flagged".into(), true)?;
    notification_expire(&db, "usr_self".into(), "expired".into())?;

    for id in ["flagged", "expired"] {
        let row = rows_by_id(
            &db,
            "SELECT expired, seen FROM usrself_notifications WHERE id = @id",
            id,
        )?;
        assert_eq!(row, vec![vec![json!(1), json!(1)]], "{id}");
    }
    Ok(())
}

#[test]
fn mark_read_bulk_marks_seen_or_expires_per_version() -> Result<(), Error> {
    let (_dir, db) = test_db("mark-read-bulk")?;
    for (id, notification_type) in [("legacy", "friendRequest"), ("invite", "invite")] {
        notification_add_v1(
            &db,
            "usr_self".into(),
            json!({
                "id": id,
                "created_at": "2026-05-15T00:00:00Z",
                "type": notification_type
            }),
        )?;
    }
    notification_add_v2(
        &db,
        "usr_self".into(),
        json!({
            "id": "modern",
            "createdAt": "2026-05-15T00:01:00Z",
            "seen": false
        }),
    )?;

    notification_mark_read_bulk(
        &db,
        "usr_self".into(),
        vec![
            NotificationRead {
                id: "legacy".into(),
                version: 1,
                expire: false,
            },
            NotificationRead {
                id: "invite".into(),
                version: 1,
                expire: true,
            },
            NotificationRead {
                id: "modern".into(),
                version: 2,
                expire: false,
            },
        ],
    )?;

    let legacy = rows_by_id(
        &db,
        "SELECT expired, seen FROM usrself_notifications WHERE id = @id",
        "legacy",
    )?;
    let invite = rows_by_id(
        &db,
        "SELECT expired, seen FROM usrself_notifications WHERE id = @id",
        "invite",
    )?;
    let modern = rows_by_id(
        &db,
        "SELECT seen, expires_at FROM usrself_notifications_v2 WHERE id = @id",
        "modern",
    )?;
    assert_eq!(legacy[0], vec![json!(0), json!(1)]);
    assert_eq!(invite[0], vec![json!(1), json!(1)]);
    assert_eq!(modern[0], vec![json!(1), Value::Null]);
    Ok(())
}

#[test]
fn combined_expire_and_delete_cover_both_versions_without_crossing_accounts() -> Result<(), Error> {
    let (_dir, db) = test_db("combined-actions")?;
    add_version_pair(&db, "usr_self", "shared")?;
    add_version_pair(&db, "usr_other", "shared")?;

    let before = Utc::now();
    notification_expire(&db, "usr_self".into(), " shared ".into())?;
    let after = Utc::now();

    let own_v1 = rows_by_id(
        &db,
        "SELECT expired FROM usrself_notifications WHERE id = @id",
        "shared",
    )?;
    let own_v2 = rows_by_id(
        &db,
        "SELECT expires_at, seen FROM usrself_notifications_v2 WHERE id = @id",
        "shared",
    )?;
    assert_eq!(own_v1[0][0], json!(1));
    assert_eq!(own_v2[0][1], json!(1));
    let expires_at = DateTime::parse_from_rfc3339(own_v2[0][0].as_str().unwrap())
        .unwrap()
        .with_timezone(&Utc);
    assert!(expires_at.timestamp_millis() >= before.timestamp_millis());
    assert!(expires_at.timestamp_millis() <= after.timestamp_millis());

    let other_v1 = rows_by_id(
        &db,
        "SELECT expired FROM usrother_notifications WHERE id = @id",
        "shared",
    )?;
    let other_v2 = rows_by_id(
        &db,
        "SELECT expires_at, seen FROM usrother_notifications_v2 WHERE id = @id",
        "shared",
    )?;
    assert_eq!(other_v1[0][0], json!(0));
    assert_eq!(other_v2[0], vec![Value::Null, json!(0)]);

    notification_delete(&db, "usr_self".into(), " shared ".into())?;
    let own_count = db.execute(
        concat!(
            "SELECT (SELECT COUNT(*) FROM usrself_notifications WHERE id = 'shared') + ",
            "(SELECT COUNT(*) FROM usrself_notifications_v2 WHERE id = 'shared')"
        ),
        &Default::default(),
    )?;
    let other_count = db.execute(
        concat!(
            "SELECT (SELECT COUNT(*) FROM usrother_notifications WHERE id = 'shared') + ",
            "(SELECT COUNT(*) FROM usrother_notifications_v2 WHERE id = 'shared')"
        ),
        &Default::default(),
    )?;
    assert_eq!(own_count[0][0], json!(0));
    assert_eq!(other_count[0][0], json!(2));
    Ok(())
}

#[test]
fn combined_expire_rolls_back_both_versions_when_the_second_write_fails() -> Result<(), Error> {
    let (_dir, db) = test_db("expire-atomic")?;
    add_version_pair(&db, "usr_self", "atomic")?;
    db.execute_non_query(
        concat!(
            "CREATE TRIGGER usrself_notification_expire_abort ",
            "BEFORE UPDATE ON usrself_notifications_v2 ",
            "WHEN NEW.id = 'atomic' BEGIN SELECT RAISE(ABORT, 'stop'); END"
        ),
        &Default::default(),
    )?;

    let error = notification_expire(&db, "usr_self".into(), "atomic".into()).unwrap_err();
    assert!(matches!(error, Error::Sqlite { .. }));
    let v1 = rows_by_id(
        &db,
        "SELECT expired FROM usrself_notifications WHERE id = @id",
        "atomic",
    )?;
    let v2 = rows_by_id(
        &db,
        "SELECT expires_at, seen FROM usrself_notifications_v2 WHERE id = @id",
        "atomic",
    )?;
    assert_eq!(v1[0][0], json!(0));
    assert_eq!(v2[0], vec![Value::Null, json!(0)]);
    Ok(())
}

#[test]
fn notification_v2_upsert_does_not_make_seen_rows_unseen() -> Result<(), Error> {
    let (_dir, db) = test_db("notification-v2-seen-monotonic")?;
    let notification = |seen| {
        json!({
            "id": "notif_seen",
            "createdAt": "2026-07-22T00:00:00Z",
            "type": "inviteResponse",
            "seen": seen
        })
    };

    notification_add_v2(&db, "usr_self".into(), notification(true))?;
    notification_add_v2(&db, "usr_self".into(), notification(false))?;

    let rows = rows_by_id(
        &db,
        "SELECT seen FROM usrself_notifications_v2 WHERE id = @id",
        "notif_seen",
    )?;
    assert_eq!(rows[0][0], json!(1));
    Ok(())
}
