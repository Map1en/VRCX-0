use serde_json::json;

use super::test_support::*;
use super::*;

#[test]
fn friend_log_applies_filters_limit_and_rejects_unknown_types() {
    let (_dir, db) = test_db("friend-log");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_history
            (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number)
         VALUES
            ('2026-06-01T10:00:00Z', 'Friend', 'usr_alice', 'Alice', '', 'Known', '', 1),
            ('2026-06-02T10:00:00Z', 'Friend', 'usr_bob', 'Bob', '', 'Known', '', 2),
            ('2026-06-03T10:00:00Z', 'TrustLevel', 'usr_alice', 'Alice', '', 'Trusted', 'Known', 1),
            ('2026-06-04T10:00:00Z', 'DisplayName', 'usr_alice', 'Alice New', 'Alice', 'Trusted', 'Trusted', 1)",
        &Default::default(),
    )
    .unwrap();

    let output = get_friend_log(
        &db,
        FriendLogInput {
            owner_user_id: "usr_self".into(),
            target_user_id: Some("usr_alice".into()),
            types: vec!["Friend".into(), "TrustLevel".into()],
            time_window: TimeWindow {
                from: Some("2026-06-01T00:00:00Z".into()),
                to: Some("2026-06-03T23:59:59Z".into()),
            },
            limit: Some(1),
            cursor: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.total_rows, 2);
    assert_eq!(output.returned_rows, 1);
    assert!(output.truncated);
    assert!(output.next_cursor.is_some());
    assert_eq!(output.rows[0].kind, "TrustLevel");
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(
        get_friend_log_first_created_at(&db, "usr_self", "usr_alice", "Friend").unwrap(),
        Some("2026-06-01T10:00:00Z".into())
    );
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("relationship events")));

    let error = get_friend_log(
        &db,
        FriendLogInput {
            owner_user_id: "usr_self".into(),
            target_user_id: None,
            types: vec!["Block".into()],
            time_window: TimeWindow::all(),
            limit: None,
            cursor: None,
        },
    )
    .expect_err("unknown type should be rejected");
    assert!(matches!(error, crate::Error::InvalidData(message) if message.contains("Block")));
}

#[test]
fn friend_log_cursor_returns_the_next_page() {
    let (_dir, db) = test_db("friend-log-cursor");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_history
            (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number)
         VALUES
            ('2026-06-03T10:00:00Z', 'Friend', 'usr_carol', 'Carol', '', 'Known', '', 3),
            ('2026-06-02T10:00:00Z', 'Friend', 'usr_bob', 'Bob', '', 'Known', '', 2),
            ('2026-06-01T10:00:00Z', 'Friend', 'usr_alice', 'Alice', '', 'Known', '', 1)",
        &Default::default(),
    )
    .unwrap();

    let first = get_friend_log(
        &db,
        FriendLogInput {
            owner_user_id: "usr_self".into(),
            target_user_id: None,
            types: vec!["Friend".into()],
            time_window: TimeWindow::all(),
            limit: Some(1),
            cursor: None,
        },
    )
    .unwrap();
    assert_eq!(first.rows[0].user_id, "usr_carol");
    assert_eq!(first.total_rows, 3);
    assert!(first.truncated);

    let second = get_friend_log(
        &db,
        FriendLogInput {
            owner_user_id: "usr_self".into(),
            target_user_id: None,
            types: vec!["Friend".into()],
            time_window: TimeWindow::all(),
            limit: Some(2),
            cursor: first.next_cursor,
        },
    )
    .unwrap();

    let user_ids = second
        .rows
        .iter()
        .map(|row| row.user_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(user_ids, ["usr_bob", "usr_alice"]);
    assert_eq!(second.total_rows, 3);
    assert_eq!(second.returned_rows, 2);
    assert!(!second.truncated);
    assert!(second.next_cursor.is_none());
}
