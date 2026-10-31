use super::*;
use std::path::PathBuf;

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
            "vrcx-0-friends-{name}-{}-{nonce}",
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

fn test_db(name: &str) -> (TestDir, DatabaseService) {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
    (dir, db)
}

fn current_entry(
    user_id: &str,
    display_name: &str,
    trust_level: Option<&str>,
    friend_number: i64,
) -> FriendLogCurrentEntryInput {
    FriendLogCurrentEntryInput {
        user_id: user_id.into(),
        display_name: display_name.into(),
        trust_level: trust_level.map(String::from),
        friend_number: Value::from(friend_number),
    }
}

fn history_entry(user_id: &str, kind: &str) -> FriendLogHistoryEntryInput {
    FriendLogHistoryEntryInput {
        row_id: Value::Null,
        created_at: "2026-06-01T00:00:00Z".into(),
        r#type: kind.into(),
        user_id: user_id.into(),
        display_name: String::new(),
        previous_display_name: String::new(),
        trust_level: String::new(),
        previous_trust_level: String::new(),
        friend_number: Value::Null,
    }
}

fn all_history(db: &DatabaseService) -> Vec<FriendLogHistoryOutput> {
    friend_log_history_query(
        db,
        FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: String::new(),
            types: Vec::new(),
            ..Default::default()
        },
    )
    .unwrap()
}

#[test]
fn friend_log_current_list_returns_empty_for_blank_user_id() {
    let (_dir, db) = test_db("current-list-blank");

    let rows = friend_log_current_list(&db, "   ".into()).unwrap();

    assert!(rows.is_empty());
}

#[test]
fn friend_log_current_list_orders_by_friend_number_then_name_then_id() {
    let (_dir, db) = test_db("current-list-order");
    friend_log_replace_current(
        &db,
        "usr_self".into(),
        vec![
            current_entry("usr_b", "Zed", Some("Known"), 2),
            current_entry("usr_a", "Alice", Some("Trusted"), 1),
            current_entry("usr_c", "alice", Some("Known"), 1),
        ],
        FriendLogReplaceOptionsInput::default(),
    )
    .unwrap();

    let rows = friend_log_current_list(&db, "usr_self".into()).unwrap();

    let ids = rows
        .iter()
        .map(|row| row.user_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["usr_a", "usr_c", "usr_b"]);
}

#[test]
fn friend_display_names_returns_empty_when_owner_or_ids_are_missing() {
    let (_dir, db) = test_db("display-names-empty");

    assert!(
        friend_display_names(&db, OwnerId::new(""), &["usr_a".into()])
            .unwrap()
            .is_empty()
    );
    assert!(friend_display_names(&db, OwnerId::new("usr_self"), &[])
        .unwrap()
        .is_empty());
}

#[test]
fn friend_display_names_scopes_to_requested_ids_only() {
    let (_dir, db) = test_db("display-names-scoped");
    friend_log_replace_current(
        &db,
        "usr_self".into(),
        vec![
            current_entry("usr_a", "Alice", Some("Known"), 1),
            current_entry("usr_b", "Bob", Some("Known"), 2),
        ],
        FriendLogReplaceOptionsInput::default(),
    )
    .unwrap();

    let names =
        friend_display_names(&db, OwnerId::new("usr_self"), &["usr_a".to_string()]).unwrap();

    assert_eq!(names.len(), 1);
    assert_eq!(names.get("usr_a").map(String::as_str), Some("Alice"));
}

#[test]
fn friend_log_replace_current_defaults_trust_level_to_visitor_when_missing() {
    let (_dir, db) = test_db("replace-default-trust");

    friend_log_replace_current(
        &db,
        "usr_self".into(),
        vec![current_entry("usr_a", "Alice", None, 1)],
        FriendLogReplaceOptionsInput::default(),
    )
    .unwrap();

    let rows = friend_log_current_list(&db, "usr_self".into()).unwrap();
    assert_eq!(rows[0].trust_level, "Visitor");
}

#[test]
fn friend_log_replace_current_logs_history_only_for_friends_that_existed() {
    let (_dir, db) = test_db("replace-removed-history");
    friend_log_replace_current(
        &db,
        "usr_self".into(),
        vec![
            current_entry("usr_alice", "Alice", Some("Known"), 1),
            current_entry("usr_bob", "Bob", Some("Known"), 2),
        ],
        FriendLogReplaceOptionsInput::default(),
    )
    .unwrap();

    let result = friend_log_replace_current(
        &db,
        "usr_self".into(),
        vec![current_entry("usr_carol", "Carol", Some("Known"), 3)],
        FriendLogReplaceOptionsInput {
            history_entries: vec![
                history_entry("usr_alice", "Unfriend"),
                history_entry("usr_dave", "Unfriend"),
            ],
            added_history_entries: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(result.history_count, 1);
    let rows = friend_log_current_list(&db, "usr_self".into()).unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_carol"]
    );
    let history = all_history(&db);
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].user_id, "usr_alice");
}

#[test]
fn friend_log_replace_current_logs_added_history_only_for_new_friends() {
    let (_dir, db) = test_db("replace-added-history");
    friend_log_replace_current(
        &db,
        "usr_self".into(),
        vec![current_entry("usr_alice", "Alice", Some("Known"), 1)],
        FriendLogReplaceOptionsInput::default(),
    )
    .unwrap();

    let result = friend_log_replace_current(
        &db,
        "usr_self".into(),
        vec![
            current_entry("usr_alice", "Alice", Some("Known"), 1),
            current_entry("usr_bob", "Bob", Some("Known"), 2),
        ],
        FriendLogReplaceOptionsInput {
            history_entries: Vec::new(),
            added_history_entries: vec![
                history_entry("usr_alice", "Friend"),
                history_entry("usr_bob", "Friend"),
            ],
        },
    )
    .unwrap();

    assert_eq!(result.history_count, 1);
    let history = all_history(&db);
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].user_id, "usr_bob");
}

#[test]
fn friend_log_delete_current_array_short_circuits_for_empty_ids() {
    let (_dir, db) = test_db("delete-array-empty");

    let result =
        friend_log_delete_current_array(&db, "usr_self".into(), vec![], Default::default())
            .unwrap();

    assert_eq!(result.count, 0);
    assert_eq!(result.history_count, 0);
}

#[test]
fn friend_log_delete_current_array_counts_only_ids_that_existed_and_logs_matched_history() {
    let (_dir, db) = test_db("delete-array-counts");
    friend_log_replace_current(
        &db,
        "usr_self".into(),
        vec![
            current_entry("usr_alice", "Alice", Some("Known"), 1),
            current_entry("usr_bob", "Bob", Some("Known"), 2),
        ],
        FriendLogReplaceOptionsInput::default(),
    )
    .unwrap();

    let result = friend_log_delete_current_array(
        &db,
        "usr_self".into(),
        vec!["usr_alice".into(), "usr_ghost".into()],
        FriendLogDeleteOptionsInput {
            history_entries: vec![history_entry("usr_alice", "Unfriend")],
        },
    )
    .unwrap();

    assert_eq!(result.count, 1);
    assert_eq!(result.history_count, 1);
    let remaining = friend_log_current_list(&db, "usr_self".into()).unwrap();
    assert_eq!(
        remaining
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_bob"]
    );
}

#[test]
fn friend_log_upsert_current_short_circuits_for_blank_target_user_id() {
    let (_dir, db) = test_db("upsert-blank-target");

    let result = friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("  ", "Nobody", Some("Known"), 1),
        FriendLogUpsertOptionsInput::default(),
    )
    .unwrap();

    assert_eq!(result.inserted, Some(false));
    assert_eq!(result.count, 0);
}

#[test]
fn friend_log_upsert_current_inserts_new_friend_and_logs_history_when_provided() {
    let (_dir, db) = test_db("upsert-insert");

    let result = friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "Alice", Some("Known"), 1),
        FriendLogUpsertOptionsInput {
            history_entry: Some(history_entry("usr_mismatched", "Friend")),
            force_history: false,
        },
    )
    .unwrap();

    assert_eq!(result.inserted, Some(true));
    assert_eq!(result.history_count, 1);
    let rows = friend_log_current_list(&db, "usr_self".into()).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].display_name, "Alice");
    let history = all_history(&db);
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].user_id, "usr_alice");
}

#[test]
fn friend_log_upsert_current_update_preserves_friend_number_unless_new_value_is_positive() {
    let (_dir, db) = test_db("upsert-update-friend-number");
    friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "Alice", Some("Known"), 5),
        FriendLogUpsertOptionsInput::default(),
    )
    .unwrap();

    let unchanged = friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "AliceRenamed", Some("Trusted"), 0),
        FriendLogUpsertOptionsInput::default(),
    )
    .unwrap();
    assert_eq!(unchanged.inserted, Some(false));
    let after_zero = friend_log_current_list(&db, "usr_self".into()).unwrap();
    assert_eq!(after_zero[0].display_name, "AliceRenamed");
    assert_eq!(after_zero[0].trust_level, "Trusted");
    assert_eq!(after_zero[0].friend_number, 5);

    friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "AliceRenamed", Some("Trusted"), 9),
        FriendLogUpsertOptionsInput::default(),
    )
    .unwrap();
    let after_positive = friend_log_current_list(&db, "usr_self".into()).unwrap();
    assert_eq!(after_positive[0].friend_number, 9);
}

#[test]
fn friend_log_upsert_current_numbers_new_friends_like_the_realtime_writer() {
    let (_dir, db) = test_db("upsert-next-friend-number");
    friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "Alice", Some("Known"), 5),
        FriendLogUpsertOptionsInput::default(),
    )
    .unwrap();

    friend_log_upsert_current(
        &db,
        "usr_self".into(),
        FriendLogCurrentEntryInput {
            user_id: "usr_bob".into(),
            display_name: "Bob".into(),
            trust_level: None,
            friend_number: Value::Null,
        },
        FriendLogUpsertOptionsInput {
            history_entry: Some(history_entry("usr_bob", "Friend")),
            force_history: false,
        },
    )
    .unwrap();

    let rows = friend_log_current_list(&db, "usr_self".into()).unwrap();
    let bob = rows.iter().find(|row| row.user_id == "usr_bob").unwrap();
    assert_eq!(bob.friend_number, 6);
    assert_eq!(bob.trust_level, "Visitor");
    let history = all_history(&db);
    assert_eq!(history[0].friend_number, 6);
    assert_eq!(history[0].trust_level, "Visitor");
}

#[test]
fn friend_log_upsert_current_keeps_known_trust_and_name_when_the_update_lacks_them() {
    let (_dir, db) = test_db("upsert-keep-known-facts");
    friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "Alice", Some("Trusted"), 3),
        FriendLogUpsertOptionsInput::default(),
    )
    .unwrap();

    friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "Unknown", None, 0),
        FriendLogUpsertOptionsInput::default(),
    )
    .unwrap();

    let rows = friend_log_current_list(&db, "usr_self".into()).unwrap();
    assert_eq!(rows[0].display_name, "Alice");
    assert_eq!(rows[0].trust_level, "Trusted");
    assert_eq!(rows[0].friend_number, 3);
}

#[test]
fn friend_log_upsert_current_skips_history_on_update_unless_forced() {
    let (_dir, db) = test_db("upsert-update-history");
    friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "Alice", Some("Known"), 1),
        FriendLogUpsertOptionsInput::default(),
    )
    .unwrap();

    let without_force = friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "Alice", Some("Known"), 1),
        FriendLogUpsertOptionsInput {
            history_entry: Some(history_entry("usr_alice", "TrustLevel")),
            force_history: false,
        },
    )
    .unwrap();
    assert_eq!(without_force.history_count, 0);

    let with_force = friend_log_upsert_current(
        &db,
        "usr_self".into(),
        current_entry("usr_alice", "Alice", Some("Known"), 1),
        FriendLogUpsertOptionsInput {
            history_entry: Some(history_entry("usr_alice", "TrustLevel")),
            force_history: true,
        },
    )
    .unwrap();
    assert_eq!(with_force.history_count, 1);
}

#[test]
fn friend_log_history_add_skips_entries_missing_type_or_user_id() {
    let (_dir, db) = test_db("history-add-skip");

    let count = friend_log_history_add(
        &db,
        "usr_self".into(),
        vec![
            history_entry("usr_alice", "Friend"),
            history_entry("usr_bob", ""),
            history_entry("", "Friend"),
        ],
    )
    .unwrap();

    assert_eq!(count, 1);
    let history = all_history(&db);
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].user_id, "usr_alice");
}

#[test]
fn friend_log_history_delete_uses_row_id_when_positive_and_composite_key_otherwise() {
    let (_dir, db) = test_db("history-delete");
    friend_log_history_add(
        &db,
        "usr_self".into(),
        vec![
            history_entry("usr_alice", "Friend"),
            history_entry("usr_bob", "Friend"),
        ],
    )
    .unwrap();
    let rows = all_history(&db);
    assert_eq!(rows.len(), 2);
    let alice_row_id = rows
        .iter()
        .find(|row| row.user_id == "usr_alice")
        .unwrap()
        .row_id;

    let mut by_id = history_entry("usr_alice", "Friend");
    by_id.row_id = Value::from(alice_row_id);
    friend_log_history_delete(&db, "usr_self".into(), by_id).unwrap();

    let remaining_after_id_delete = all_history(&db);
    assert_eq!(remaining_after_id_delete.len(), 1);
    assert_eq!(remaining_after_id_delete[0].user_id, "usr_bob");

    friend_log_history_delete(&db, "usr_self".into(), history_entry("usr_bob", "Friend")).unwrap();

    assert!(all_history(&db).is_empty());
}

#[test]
fn friend_log_history_query_filters_by_target_user_and_types() {
    let (_dir, db) = test_db("history-query-filters");
    friend_log_history_add(
        &db,
        "usr_self".into(),
        vec![
            history_entry("usr_alice", "Friend"),
            history_entry("usr_alice", "TrustLevel"),
            history_entry("usr_bob", "Friend"),
        ],
    )
    .unwrap();

    let alice_only = friend_log_history_query(
        &db,
        FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_alice".into(),
            types: Vec::new(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(alice_only.len(), 2);

    let alice_trust_level_only = friend_log_history_query(
        &db,
        FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            target_user_id: "usr_alice".into(),
            types: vec!["TrustLevel".into()],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(alice_trust_level_only.len(), 1);
    assert_eq!(alice_trust_level_only[0].r#type, "TrustLevel");
}

#[test]
fn friend_log_history_pages_keep_equal_timestamps_and_owner_filters() {
    use vrcx_0_contracts::friend_log::FriendLogHistoryCursor;
    let (_dir, db) = test_db("history-cursor");
    friend_log_history_add(
        &db,
        "usr_self".into(),
        vec![
            history_entry("usr_a", "Friend"),
            history_entry("usr_b", "Unfriend"),
            history_entry("usr_c", "Friend"),
            history_entry("usr_d", "Friend"),
        ],
    )
    .unwrap();
    friend_log_history_add(
        &db,
        "usr_other".into(),
        vec![history_entry("usr_foreign", "Friend")],
    )
    .unwrap();
    let query = FriendLogHistoryQueryInput {
        user_id: "usr_self".into(),
        excluded_types: vec!["Unfriend".into()],
        limit: Some(2),
        ..Default::default()
    };
    let first = friend_log_history_query(&db, query.clone()).unwrap();
    assert_eq!(
        first
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_d", "usr_c"]
    );
    let cursor = FriendLogHistoryCursor {
        created_at: first[1].created_at.clone(),
        row_id: first[1].row_id,
    };
    friend_log_history_add(
        &db,
        "usr_self".into(),
        vec![history_entry("usr_new", "Friend")],
    )
    .unwrap();
    let older = friend_log_history_query(
        &db,
        FriendLogHistoryQueryInput {
            cursor: Some(cursor),
            ..query
        },
    )
    .unwrap();
    assert_eq!(older.len(), 1);
    assert_eq!(older[0].user_id, "usr_a");
}

#[test]
fn friend_log_history_date_range_includes_endpoints_and_handles_timestamp_offsets() {
    let (_dir, db) = test_db("history-date-range");
    let entries = [
        ("usr_before", "2026-08-31T14:59:59.999Z"),
        ("usr_start", "2026-09-01T00:00:00+09:00"),
        ("usr_end", "2026-09-01T14:59:59.999Z"),
        ("usr_after", "2026-09-01T15:00:00Z"),
    ]
    .into_iter()
    .map(|(id, date)| {
        let mut entry = history_entry(id, "Friend");
        entry.created_at = date.into();
        entry
    })
    .collect();
    friend_log_history_add(&db, "usr_self".into(), entries).unwrap();
    let query = FriendLogHistoryQueryInput {
        user_id: "usr_self".into(),
        date_from: "2026-08-31T15:00:00.000Z".into(),
        date_to: "2026-09-01T14:59:59.999Z".into(),
        ..Default::default()
    };
    let rows = friend_log_history_query(&db, query.clone()).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .all(|row| ["usr_start", "usr_end"].contains(&row.user_id.as_str())));
    let from_only = friend_log_history_query(
        &db,
        FriendLogHistoryQueryInput {
            date_to: String::new(),
            ..query
        },
    )
    .unwrap();
    assert_eq!(from_only.len(), 3);
}

#[test]
fn friend_log_history_cursor_orders_actual_times_across_legacy_formats() {
    use vrcx_0_contracts::friend_log::FriendLogHistoryCursor;
    let (_dir, db) = test_db("history-time-order");
    let entries = [
        ("usr_older", "2026-09-01T00:00:00Z"),
        ("usr_newer", "2026-09-01T00:00:00.500Z"),
        ("usr_same_time", "2026-09-01T09:00:00+09:00"),
        ("usr_unknown_time", ""),
    ]
    .into_iter()
    .map(|(id, date)| {
        let mut entry = history_entry(id, "Friend");
        entry.created_at = date.into();
        entry
    })
    .collect();
    friend_log_history_add(&db, "usr_self".into(), entries).unwrap();
    let first = friend_log_history_query(
        &db,
        FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            limit: Some(2),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        first
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_newer", "usr_same_time"]
    );
    let second = friend_log_history_query(
        &db,
        FriendLogHistoryQueryInput {
            user_id: "usr_self".into(),
            limit: Some(2),
            cursor: Some(FriendLogHistoryCursor {
                created_at: first[1].created_at.clone(),
                row_id: first[1].row_id,
            }),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        second
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_older", "usr_unknown_time"]
    );
}
