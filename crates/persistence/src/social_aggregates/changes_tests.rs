use super::test_support::*;
use super::*;

#[test]
fn friend_changes_returns_recent_status_events_by_friend() {
    let (_dir, db) = test_db("friend-changes");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
            "INSERT INTO usrself_feed_status
                (created_at, user_id, display_name, status, status_description, previous_status, previous_status_description)
             VALUES
                ('2026-06-01T20:00:00Z', 'usr_alice', 'Alice', 'join me', 'Open', 'active', 'Busy'),
                ('2026-06-02T20:00:00Z', 'usr_alice', 'Alice', 'active', 'Back later', 'join me', 'Open'),
                ('2026-06-03T20:00:00Z', 'usr_bob', 'Bob', 'ask me', '', 'active', ''),
                ('2026-06-04T20:00:00Z', 'usr_alice', 'Alice', 'join me', 'Again', 'active', 'Back later')",
            &Default::default(),
        )
        .unwrap();

    let output = get_friend_changes(
        &db,
        FriendChangesInput {
            owner_user_id: "usr_self".into(),
            target_user_id: None,
            time_window: TimeWindow::all(),
            kind: FriendChangeKind::Status,
            limit: Some(10),
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 2);
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(output.rows[0].change_count, 3);
    assert_eq!(
        output.rows[0].recent_events[0].changed_at,
        "2026-06-04T20:00:00Z"
    );
    assert_eq!(
        output.rows[0].recent_events[0].kind,
        FriendChangeKind::Status
    );

    let bob = get_friend_changes(
        &db,
        FriendChangesInput {
            owner_user_id: "usr_self".into(),
            target_user_id: Some("usr_bob".into()),
            time_window: TimeWindow::all(),
            kind: FriendChangeKind::Status,
            limit: Some(1),
        },
    )
    .unwrap();
    assert_eq!(bob.rows.len(), 1);
    assert_eq!(bob.rows[0].user_id, "usr_bob");
}
