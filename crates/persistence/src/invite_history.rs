use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::common::{normalize_text, now_iso, row_i64, row_string, ParamsBuilder};
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::{DatabaseService, Error};

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendInviteCountsQueryInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub user_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendInviteCountsRow {
    pub user_id: String,
    pub sent_count: i64,
    pub received_count: i64,
}

pub fn record_successful_invite_send(
    db: &DatabaseService,
    owner_user_id: &str,
    receiver_user_id: &str,
    source: &str,
    source_notification_id: Option<&str>,
) -> Result<bool, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    let receiver_user_id = normalize_text(receiver_user_id);
    let source = normalize_text(source);
    let source_notification_id = normalize_text(source_notification_id.unwrap_or_default());
    if owner_user_id.is_empty() || receiver_user_id.is_empty() || source.is_empty() {
        return Err(Error::Database(
            "Invite send history requires owner, receiver, and source.".into(),
        ));
    }

    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let table = format!("{user_prefix}_invite_send_history");
    let changed = db.execute_non_query(
        &format!(
            "INSERT OR IGNORE INTO {table} \
             (created_at, receiver_user_id, source, source_notification_id) \
             VALUES (@created_at, @receiver_user_id, @source, @source_notification_id)"
        ),
        &ParamsBuilder::new()
            .set("created_at", now_iso())
            .set("receiver_user_id", receiver_user_id)
            .set("source", source)
            .set("source_notification_id", source_notification_id)
            .build(),
    )?;
    Ok(changed > 0)
}

pub fn successful_invite_send_exists_for_notification(
    db: &DatabaseService,
    owner_user_id: &str,
    source_notification_id: &str,
) -> Result<bool, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    let source_notification_id = normalize_text(source_notification_id);
    if owner_user_id.is_empty() || source_notification_id.is_empty() {
        return Ok(false);
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let rows = db.execute(
        &format!(
            "SELECT COUNT(*) FROM {user_prefix}_invite_send_history \
             WHERE source_notification_id = @source_notification_id"
        ),
        &ParamsBuilder::new()
            .set("source_notification_id", source_notification_id)
            .build(),
    )?;
    Ok(rows.first().is_some_and(|row| row_i64(row, 0) > 0))
}

pub fn record_invite_automation_receipt(
    db: &DatabaseService,
    owner_user_id: &str,
    source_notification_id: &str,
    action: &str,
    target_user_id: &str,
) -> Result<bool, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    let source_notification_id = normalize_text(source_notification_id);
    let action = normalize_text(action);
    let target_user_id = normalize_text(target_user_id);
    if owner_user_id.is_empty()
        || source_notification_id.is_empty()
        || action.is_empty()
        || target_user_id.is_empty()
    {
        return Err(Error::Database(
            "Invite automation receipts require owner, notification, action, and target.".into(),
        ));
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let changed = db.execute_non_query(
        &format!(
            "INSERT OR IGNORE INTO {user_prefix}_invite_automation_receipts \
             (source_notification_id, created_at, action, target_user_id) \
             VALUES (@source_notification_id, @created_at, @action, @target_user_id)"
        ),
        &ParamsBuilder::new()
            .set("source_notification_id", source_notification_id)
            .set("created_at", now_iso())
            .set("action", action)
            .set("target_user_id", target_user_id)
            .build(),
    )?;
    Ok(changed > 0)
}

pub fn invite_automation_receipt_exists(
    db: &DatabaseService,
    owner_user_id: &str,
    source_notification_id: &str,
) -> Result<bool, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    let source_notification_id = normalize_text(source_notification_id);
    if owner_user_id.is_empty() || source_notification_id.is_empty() {
        return Ok(false);
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let rows = db.execute(
        &format!(
            "SELECT COUNT(*) FROM {user_prefix}_invite_automation_receipts \
             WHERE source_notification_id = @source_notification_id"
        ),
        &ParamsBuilder::new()
            .set("source_notification_id", source_notification_id)
            .build(),
    )?;
    Ok(rows.first().is_some_and(|row| row_i64(row, 0) > 0))
}

pub fn friend_invite_counts_query(
    db: &DatabaseService,
    input: FriendInviteCountsQueryInput,
) -> Result<Vec<FriendInviteCountsRow>, Error> {
    let owner_user_id = normalize_text(input.owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let requested = input
        .user_ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    if requested.is_empty() {
        return Ok(Vec::new());
    }

    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let mut counts = requested
        .iter()
        .map(|user_id| {
            (
                user_id.clone(),
                FriendInviteCountsRow {
                    user_id: user_id.clone(),
                    ..FriendInviteCountsRow::default()
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    let sent_rows = db.execute(
        &format!(
            "SELECT receiver_user_id, COUNT(*) \
             FROM {user_prefix}_invite_send_history \
             GROUP BY receiver_user_id"
        ),
        &Default::default(),
    )?;
    for row in sent_rows {
        let user_id = row_string(&row, 0);
        if let Some(entry) = counts.get_mut(&user_id) {
            entry.sent_count = row_i64(&row, 1);
        }
    }

    let mut received_ids = HashSet::new();
    for table in [
        format!("{user_prefix}_notifications"),
        format!("{user_prefix}_notifications_v2"),
    ] {
        let rows = db.execute(
            &format!(
                "SELECT id, sender_user_id FROM {table} \
                 WHERE lower(type) = 'invite' AND sender_user_id <> @owner_user_id"
            ),
            &ParamsBuilder::new()
                .set("owner_user_id", owner_user_id.clone())
                .build(),
        )?;
        for row in rows {
            let notification_id = row_string(&row, 0);
            let sender_user_id = row_string(&row, 1);
            if notification_id.is_empty()
                || !requested.contains(&sender_user_id)
                || !received_ids.insert(notification_id)
            {
                continue;
            }
            if let Some(entry) = counts.get_mut(&sender_user_id) {
                entry.received_count += 1;
            }
        }
    }

    Ok(counts.into_values().collect())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;
    use crate::notifications::{notification_add_v1, notification_add_v2};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-invite-history-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn test_db(name: &str) -> (TestDir, DatabaseService) {
        let dir = TestDir::new(name);
        let db = DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap();
        (dir, db)
    }

    #[test]
    fn records_only_one_auto_send_per_source_notification_and_isolates_owners() {
        let (_dir, db) = test_db("record");
        assert!(record_successful_invite_send(
            &db,
            "usr_owner",
            "usr_friend",
            "realtime-auto-invite",
            Some("not_1"),
        )
        .unwrap());
        assert!(!record_successful_invite_send(
            &db,
            "usr_owner",
            "usr_friend",
            "realtime-auto-invite",
            Some("not_1"),
        )
        .unwrap());
        assert!(record_successful_invite_send(
            &db,
            "usr_other_owner",
            "usr_friend",
            "realtime-auto-invite",
            Some("not_1"),
        )
        .unwrap());
        assert!(successful_invite_send_exists_for_notification(&db, "usr_owner", "not_1").unwrap());
    }

    #[test]
    fn automation_receipts_dedupe_notification_ids_without_counting_messages_as_invites() {
        let (_dir, db) = test_db("receipts");
        assert!(record_invite_automation_receipt(
            &db,
            "usr_owner",
            "not_message",
            "invite-message-response",
            "usr_friend",
        )
        .unwrap());
        assert!(!record_invite_automation_receipt(
            &db,
            "usr_owner",
            "not_message",
            "request-invite-message-response",
            "usr_friend",
        )
        .unwrap());
        assert!(invite_automation_receipt_exists(&db, "usr_owner", "not_message").unwrap());

        let rows = friend_invite_counts_query(
            &db,
            FriendInviteCountsQueryInput {
                owner_user_id: "usr_owner".into(),
                user_ids: vec!["usr_friend".into()],
            },
        )
        .unwrap();
        assert_eq!(rows[0].sent_count, 0);
    }

    #[test]
    fn counts_exact_invites_and_deduplicates_received_ids_across_versions() {
        let (_dir, db) = test_db("counts");
        record_successful_invite_send(&db, "usr_owner", "usr_alice", "manual", None).unwrap();
        record_successful_invite_send(&db, "usr_owner", "usr_alice", "manual", None).unwrap();

        notification_add_v1(
            &db,
            "usr_owner".into(),
            json!({
                "id": "same",
                "created_at": "2026-08-01T00:00:00Z",
                "type": "invite",
                "senderUserId": "usr_alice",
                "senderUsername": "Alice"
            }),
        )
        .unwrap();
        notification_add_v2(
            &db,
            "usr_owner".into(),
            json!({
                "id": "same",
                "createdAt": "2026-08-01T00:00:00Z",
                "type": "invite",
                "senderUserId": "usr_alice"
            }),
        )
        .unwrap();
        notification_add_v2(
            &db,
            "usr_owner".into(),
            json!({
                "id": "response",
                "createdAt": "2026-08-01T00:01:00Z",
                "type": "inviteResponse",
                "senderUserId": "usr_alice"
            }),
        )
        .unwrap();

        let rows = friend_invite_counts_query(
            &db,
            FriendInviteCountsQueryInput {
                owner_user_id: "usr_owner".into(),
                user_ids: vec!["usr_alice".into(), "usr_bob".into()],
            },
        )
        .unwrap();
        let alice = rows.iter().find(|row| row.user_id == "usr_alice").unwrap();
        assert_eq!(alice.sent_count, 2);
        assert_eq!(alice.received_count, 1);
        let bob = rows.iter().find(|row| row.user_id == "usr_bob").unwrap();
        assert_eq!(bob.sent_count, 0);
        assert_eq!(bob.received_count, 0);
    }
}
