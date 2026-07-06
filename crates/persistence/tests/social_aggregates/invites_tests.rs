use serde_json::json;

use super::test_support::*;
use super::*;

#[test]
fn invite_history_groups_received_and_sent_notifications() {
    let (_dir, db) = test_db("invite-history");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
            "INSERT INTO usrself_notifications
                (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired)
             VALUES
                ('n1', '2026-06-01T20:00:00Z', 'invite', 'usr_alice', 'Alice', 'usr_self', '', '', '', '', '', '', '', 0),
                ('n2', '2026-06-02T20:00:00Z', 'requestInvite', 'usr_self', 'Self', 'usr_bob', '', '', '', '', '', '', '', 0)",
            &Default::default(),
        )
        .unwrap();
    db.execute_non_query(
            "INSERT INTO usrself_notifications_v2
                (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details)
             VALUES
                ('n3', '2026-06-03T20:00:00Z', '', '', 'invite', '', '', '', '', '', 0, 'usr_alice', 'Alice', '', '', '')",
            &Default::default(),
        )
        .unwrap();

    let output = get_invite_history(
        &db,
        InviteHistoryInput {
            owner_user_id: "usr_self".into(),
            time_window: TimeWindow::all(),
            direction: InviteDirection::Both,
            limit: Some(10),
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 2);
    let alice = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_alice")
        .unwrap();
    assert_eq!(alice.direction, InviteDirection::Received);
    assert_eq!(alice.total_count, 2);
    assert_eq!(alice.last_invite_at, "2026-06-03T20:00:00Z");
    let bob = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_bob")
        .unwrap();
    assert_eq!(bob.direction, InviteDirection::Sent);
    assert_eq!(bob.total_count, 1);
}
