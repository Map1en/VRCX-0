use std::path::PathBuf;

use serde_json::json;

use super::{
    notification_add_v1, notification_add_v2, notification_list_query, NotificationListItemOutput,
    NotificationListQueryInput,
};
use crate::{DatabaseService, Error};

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
            "vrcx-0-notification-query-{name}-{}-{nonce}",
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

fn add_v1(
    db: &DatabaseService,
    user_id: &str,
    id: &str,
    created_at: &str,
    message: &str,
) -> Result<(), Error> {
    notification_add_v1(
        db,
        user_id.into(),
        json!({
            "id": id,
            "created_at": created_at,
            "type": "invite",
            "message": message,
            "senderUserId": "usr_sender_v1",
            "senderUsername": "Legacy Sender",
            "details": { "worldId": "wrld_v1" }
        }),
    )
}

fn add_v2(
    db: &DatabaseService,
    user_id: &str,
    id: &str,
    created_at: &str,
    seen: bool,
    expires_at: &str,
) -> Result<(), Error> {
    notification_add_v2(
        db,
        user_id.into(),
        json!({
            "id": id,
            "createdAt": created_at,
            "updatedAt": created_at,
            "expiresAt": expires_at,
            "type": "invite",
            "message": format!("message-{id}"),
            "title": format!("title-{id}"),
            "seen": seen,
            "senderUserId": "usr_sender_v2",
            "senderUsername": "Current Sender",
            "data": {},
            "responses": [],
            "details": { "worldId": "wrld_v2" }
        }),
    )
}

fn query(
    db: &DatabaseService,
    user_id: &str,
    per_table_limit: i64,
    limit: i64,
    include_unseen: bool,
) -> Result<Vec<NotificationListItemOutput>, Error> {
    notification_list_query(
        db,
        NotificationListQueryInput {
            user_id: user_id.into(),
            search: String::new(),
            filters: Vec::new(),
            per_table_limit,
            limit,
            include_unseen,
        },
    )
}

#[test]
fn merged_notification_list_keeps_original_v2_precedence_and_global_order() -> Result<(), Error> {
    let (_dir, db) = test_db("merge")?;
    let user_id = "usr_owner";
    add_v1(
        &db,
        user_id,
        "notif_shared",
        "2026-01-03T12:00:00Z",
        "legacy duplicate",
    )?;
    add_v2(
        &db,
        user_id,
        "notif_shared",
        "2026-01-01T10:00:00Z",
        true,
        "2099-01-01T00:00:00Z",
    )?;
    add_v1(
        &db,
        user_id,
        "notif_other",
        "2026-01-02T11:00:00Z",
        "legacy other",
    )?;

    let rows = query(&db, user_id, 10, 10, false)?;

    assert_eq!(
        rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        vec!["notif_other", "notif_shared"]
    );
    let shared = rows.iter().find(|row| row.id == "notif_shared").unwrap();
    assert_eq!(shared.version, 2);
    assert_eq!(shared.title, "title-notif_shared");
    assert_eq!(shared.sender_username, "Current Sender");
    Ok(())
}

#[test]
fn unseen_expansion_keeps_unexpired_rows_beyond_the_per_table_window() -> Result<(), Error> {
    let (_dir, db) = test_db("unseen")?;
    let user_id = "usr_owner";
    add_v2(
        &db,
        user_id,
        "seen-newest",
        "2026-03-03T00:00:00Z",
        true,
        "2099-01-01T00:00:00Z",
    )?;
    add_v2(
        &db,
        user_id,
        "unseen-older",
        "2026-03-02T00:00:00Z",
        false,
        "2099-01-01T00:00:00Z",
    )?;
    add_v2(
        &db,
        user_id,
        "unseen-expired",
        "2026-03-01T00:00:00Z",
        false,
        "2000-01-01T00:00:00Z",
    )?;

    assert_eq!(
        query(&db, user_id, 1, 10, false)?
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        vec!["seen-newest"]
    );
    assert_eq!(
        query(&db, user_id, 1, 10, true)?
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        vec!["seen-newest", "unseen-older"]
    );
    Ok(())
}

#[test]
fn notification_list_applies_final_limit_with_stable_id_ties() -> Result<(), Error> {
    let (_dir, db) = test_db("limit")?;
    let user_id = "usr_owner";
    for id in ["notif_a", "notif_c", "notif_b"] {
        add_v1(&db, user_id, id, "2026-04-01T00:00:00Z", "same timestamp")?;
    }

    let rows = query(&db, user_id, 10, 2, false)?;

    assert_eq!(
        rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        vec!["notif_c", "notif_b"]
    );
    Ok(())
}

#[test]
fn notification_tables_remain_scoped_to_the_requested_account() -> Result<(), Error> {
    let (_dir, db) = test_db("account-scope")?;
    add_v1(
        &db,
        "usr_owner_a",
        "notif_a",
        "2026-05-01T00:00:00Z",
        "owner a",
    )?;
    add_v1(
        &db,
        "usr_owner_b",
        "notif_b",
        "2026-05-02T00:00:00Z",
        "owner b",
    )?;

    let rows = query(&db, "usr_owner_a", 10, 10, true)?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "notif_a");
    Ok(())
}
