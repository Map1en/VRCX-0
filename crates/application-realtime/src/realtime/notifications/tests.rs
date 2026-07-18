use super::*;

fn ws(message_type: &str, content: Value) -> RealtimeWsMessagePayload {
    RealtimeWsMessagePayload {
        json: json!({
            "type": message_type,
            "content": content
        }),
        raw: "{}".into(),
        received_at: "2026-06-08T10:00:00Z".into(),
    }
}

#[test]
fn notification_v1_routes_projection_and_persistence_filters() {
    let output = apply_notification_ws_message(
        " usr_self ",
        "https://api.example.test/api/1",
        7,
        &ws(
            "notification",
            json!({
                "id": "notif_1",
                "senderUserId": "usr_friend",
                "senderUsername": "Friend",
                "type": "invite",
                "message": "Join me"
            }),
        ),
    )
    .expect("v1 notification output");

    assert_eq!(output.owner_user_id, "usr_self");
    assert_eq!(output.projection.generation, 7);
    assert_eq!(output.persistence.notification_v1_upserts.len(), 1);
    assert_eq!(output.projection.upserts.len(), 1);
    let upsert = &output.projection.upserts[0];
    assert!(upsert.notify_menu);
    assert!(upsert.deliver_runtime);
    assert!(upsert.run_automation);
    assert_eq!(upsert.notification["version"], json!(1));
    assert_eq!(
        upsert.notification["createdAt"],
        json!("2026-06-08T10:00:00Z")
    );
    assert_eq!(upsert.notification["seen"], json!(false));

    let self_sent = apply_notification_ws_message(
        "usr_self",
        "https://api.example.test/api/1",
        7,
        &ws(
            "notification",
            json!({
                "id": "notif_self",
                "senderUserId": "usr_self",
                "type": "invite"
            }),
        ),
    )
    .expect("self-sent notification still projects");
    assert!(self_sent.persistence.notification_v1_upserts.is_empty());
    assert_eq!(self_sent.projection.upserts.len(), 1);

    let dotted_type = apply_notification_ws_message(
        "usr_self",
        "https://api.example.test/api/1",
        7,
        &ws(
            "notification",
            json!({
                "id": "notif_dotted",
                "senderUserId": "usr_friend",
                "type": "group.announcement"
            }),
        ),
    )
    .expect("dotted v1 notification still projects");
    assert!(dotted_type.persistence.notification_v1_upserts.is_empty());
}

#[test]
fn notification_v2_routes_seen_and_boop_legacy_fields() {
    let output = apply_notification_ws_message(
        "usr_self",
        "https://api.example.test/api/1/",
        7,
        &ws(
            "notification-v2",
            json!({
                "id": "notif_v2",
                "type": "boop",
                "title": "Boop",
                "seen": true,
                "details": { "emojiId": "default_smile" }
            }),
        ),
    )
    .expect("v2 notification output");

    assert_eq!(output.persistence.notification_v2_upserts.len(), 1);
    let notification = &output.projection.upserts[0].notification;
    assert_eq!(notification["version"], json!(2));
    assert_eq!(notification["title"], json!(""));
    assert_eq!(notification["message"], json!("Boop smile"));
    assert_eq!(notification["imageUrl"], json!("default_smile"));
    assert_eq!(notification["createdAt"], json!("2026-06-08T10:00:00Z"));
    assert!(!output.projection.upserts[0].notify_menu);
    assert!(output.projection.upserts[0].deliver_runtime);
    assert!(output.projection.upserts[0].run_automation);
}

#[test]
fn notification_v2_update_routes_update_and_seen_projection() {
    let output = apply_notification_ws_message(
        "usr_self",
        "https://api.example.test/api/1",
        7,
        &ws(
            "notification-v2-update",
            json!({
                "id": "notif_v2",
                "updates": {
                    "seen": true,
                    "data": "{\"slot\":1}",
                    "responses": "[{\"text\":\"OK\"}]",
                    "details": "{\"emojiId\":\"emoji_custom\",\"emojiVersion\":3}",
                    "type": "invite"
                }
            }),
        ),
    )
    .expect("v2 update output");

    assert_eq!(output.persistence.notification_v2_updates.len(), 1);
    let update = &output.persistence.notification_v2_updates[0];
    assert_eq!(update.id, "notif_v2");
    assert_eq!(update.received_at, "2026-06-08T10:00:00Z");
    assert_eq!(update.updates["data"]["slot"], json!(1));
    assert_eq!(update.updates["responses"][0]["text"], json!("OK"));
    assert_eq!(update.updates["details"]["emojiId"], json!("emoji_custom"));
    assert_eq!(output.projection.seen_ids, vec!["notif_v2"]);
    assert!(output.projection.clear_menu_if_no_unseen);
    let upsert = &output.projection.upserts[0];
    assert_eq!(
        upsert.insert_defaults.as_ref().unwrap()["seen"],
        json!(false)
    );
    assert!(!upsert.deliver_runtime);
    assert!(!upsert.run_automation);
}

#[test]
fn notification_terminal_routes_seen_and_expire_ids() {
    let delete = apply_notification_ws_message(
        "usr_self",
        "https://api.example.test/api/1",
        7,
        &ws("notification-v2-delete", json!({ "ids": ["a", "", "b"] })),
    )
    .expect("delete output");
    assert_eq!(delete.projection.expired_ids, vec!["a", "b"]);
    assert_eq!(delete.projection.seen_ids, vec!["a", "b"]);
    assert_eq!(delete.persistence.notification_expirations.len(), 2);
    assert!(delete.projection.clear_menu_if_no_unseen);

    let seen = apply_notification_ws_message(
        "usr_self",
        "https://api.example.test/api/1",
        7,
        &ws("see-notification", json!("seen_id")),
    )
    .expect("see output");
    assert_eq!(seen.persistence.notification_seen, vec!["seen_id"]);
    assert_eq!(seen.projection.seen_ids, vec!["seen_id"]);

    let hidden = apply_notification_ws_message(
        "usr_self",
        "https://api.example.test/api/1",
        7,
        &ws(
            "hide-notification",
            json!({ "notificationId": "hidden_id" }),
        ),
    )
    .expect("hide output");
    assert_eq!(hidden.projection.expired_ids, vec!["hidden_id"]);
    assert_eq!(
        hidden.persistence.notification_expirations[0].expired_at,
        "2026-06-08T10:00:00Z"
    );

    let response = apply_notification_ws_message(
        "usr_self",
        "https://api.example.test/api/1",
        7,
        &ws("response-notification", json!({ "id": "response_id" })),
    )
    .expect("response output");
    assert_eq!(response.projection.expired_ids, vec!["response_id"]);
    assert_eq!(response.projection.seen_ids, vec!["response_id"]);
}

#[test]
fn instance_closed_routes_to_v1_notification_batch() {
    let output = apply_instance_closed_ws_message(
        7,
        &ws(
            "instance-closed",
            json!({ "instanceLocation": "wrld_1:123" }),
        ),
    )
    .expect("instance closed output");

    assert_eq!(output.projection.generation, 7);
    assert_eq!(
        output.projection.notification["type"],
        json!("instance.closed")
    );
    assert_eq!(
        output.projection.feed_entry["location"],
        json!("wrld_1:123")
    );
    assert_eq!(output.persistence.notification_v1_upserts.len(), 1);
    assert!(apply_instance_closed_ws_message(7, &ws("notification", json!({}))).is_none());
}
