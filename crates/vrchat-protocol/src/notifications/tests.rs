use std::collections::HashMap;

use serde_json::{json, Value};

use super::*;

const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

fn post_data(request: &VrchatRequest) -> Value {
    let Some(VrchatUpload::LegacyImage { post_data, .. }) = request.body.as_upload() else {
        panic!("expected legacy image upload");
    };
    serde_json::from_str(post_data.as_deref().unwrap()).unwrap()
}

#[test]
fn notification_list_requests_keep_version_and_hidden_filters_separate() {
    let v1 = notifications_v1_get_input(ENDPOINT.into(), 100, 200);
    assert_eq!(v1.path.as_deref(), Some("auth/user/notifications"));
    assert_eq!(
        v1.query_params,
        Some(HashMap::from([
            ("n".to_string(), json!(100)),
            ("offset".to_string(), json!(200)),
        ]))
    );

    let v2 = notifications_v2_get_input(ENDPOINT.into(), 100, 300);
    assert_eq!(v2.path.as_deref(), Some("notifications"));
    assert_eq!(
        v2.query_params,
        Some(HashMap::from([
            ("n".to_string(), json!(100)),
            ("offset".to_string(), json!(300)),
        ]))
    );

    let hidden = hidden_friend_requests_get_input(ENDPOINT.into(), 100, 400);
    assert_eq!(hidden.path.as_deref(), Some("auth/user/notifications"));
    assert_eq!(
        hidden.query_params,
        Some(HashMap::from([
            ("type".to_string(), json!("friendRequest")),
            ("hidden".to_string(), json!(true)),
            ("n".to_string(), json!(100)),
            ("offset".to_string(), json!(400)),
        ]))
    );
}

#[test]
fn mark_seen_uses_versioned_method_and_encoded_path() {
    let (user_id, id, v1) = notification_mark_seen_input(
        ENDPOINT.into(),
        " usr_current ".into(),
        " note_1/unsafe ".into(),
        1,
    )
    .unwrap();
    assert_eq!(user_id, "usr_current");
    assert_eq!(id, "note_1/unsafe");
    assert_eq!(v1.method.as_deref(), Some("PUT"));
    assert_eq!(
        v1.path.as_deref(),
        Some("auth/user/notifications/note%5F1%2Funsafe/see")
    );

    let (_, _, v2) = notification_mark_seen_input(
        ENDPOINT.into(),
        "usr_current".into(),
        "note_1/unsafe".into(),
        2,
    )
    .unwrap();
    assert_eq!(v2.method.as_deref(), Some("POST"));
    assert_eq!(
        v2.path.as_deref(),
        Some("notifications/note%5F1%2Funsafe/see")
    );
}

#[test]
fn ignored_friend_request_hide_deletes_sender_request_with_notification_body() {
    let (id, request) = notification_hide_remote_input(
        ENDPOINT.into(),
        " note_1 ".into(),
        2,
        "ignoredFriendRequest".into(),
        " usr_sender/unsafe ".into(),
    )
    .unwrap();

    assert_eq!(id, "note_1");
    assert_eq!(request.method.as_deref(), Some("DELETE"));
    assert_eq!(
        request.path.as_deref(),
        Some("user/usr%5Fsender%2Funsafe/friendRequest")
    );
    assert_eq!(
        request.body.as_json(),
        Some(&json!({ "notificationId": "note_1" }))
    );
}

#[test]
fn ordinary_hide_uses_versioned_method_and_path_without_body() {
    let (_, v1) = notification_hide_remote_input(
        ENDPOINT.into(),
        "note_1/unsafe".into(),
        1,
        "invite".into(),
        "usr_sender".into(),
    )
    .unwrap();
    assert_eq!(v1.method.as_deref(), Some("PUT"));
    assert_eq!(
        v1.path.as_deref(),
        Some("auth/user/notifications/note%5F1%2Funsafe/hide")
    );
    assert_eq!(v1.body, VrchatRequestBody::Empty);

    let (_, v2) = notification_hide_remote_input(
        ENDPOINT.into(),
        "note_1/unsafe".into(),
        2,
        "invite".into(),
        "usr_sender".into(),
    )
    .unwrap();
    assert_eq!(v2.method.as_deref(), Some("DELETE"));
    assert_eq!(v2.path.as_deref(), Some("notifications/note%5F1%2Funsafe"));
    assert_eq!(v2.body, VrchatRequestBody::Empty);
}

#[test]
fn respond_builds_encoded_path_and_complete_json_body() {
    let (id, request) = notification_respond_input(
        ENDPOINT.into(),
        " note_1/unsafe ".into(),
        " accept ".into(),
        json!({ "slot": 2 }),
    )
    .unwrap();

    assert_eq!(id, "note_1/unsafe");
    assert_eq!(request.method.as_deref(), Some("POST"));
    assert_eq!(
        request.path.as_deref(),
        Some("notifications/note%5F1%2Funsafe/respond")
    );
    assert_eq!(
        request.body.as_json(),
        Some(&json!({
            "notificationId": "note_1/unsafe",
            "responseType": "accept",
            "responseData": { "slot": 2 },
        }))
    );
}

#[test]
fn invite_response_photo_builds_legacy_upload_request() {
    let (_, request) = invite_response_photo_input(
        ENDPOINT.into(),
        " note_1/unsafe ".into(),
        3,
        " image-data ".into(),
    )
    .unwrap();

    assert_eq!(request.method.as_deref(), Some("POST"));
    assert_eq!(
        request.path.as_deref(),
        Some("invite/note%5F1%2Funsafe/response/photo")
    );
    assert!(matches!(
        request.body.as_upload(),
        Some(VrchatUpload::LegacyImage { image_data, .. }) if image_data == "image-data"
    ));
    assert_eq!(
        post_data(&request),
        json!({ "responseSlot": 3, "rsvp": true })
    );
}

#[test]
fn invite_and_request_invite_photos_build_legacy_upload_requests() {
    let params = json!({ "message": "hello" });
    let (_, invite) = invite_photo_input(
        ENDPOINT.into(),
        " usr_target/unsafe ".into(),
        params.clone(),
        " invite-image ".into(),
    )
    .unwrap();
    assert_eq!(invite.method.as_deref(), Some("POST"));
    assert_eq!(
        invite.path.as_deref(),
        Some("invite/usr%5Ftarget%2Funsafe/photo")
    );
    assert!(matches!(
        invite.body.as_upload(),
        Some(VrchatUpload::LegacyImage { image_data, .. }) if image_data == "invite-image"
    ));
    assert_eq!(post_data(&invite), params);

    let (_, request_invite) = request_invite_photo_input(
        ENDPOINT.into(),
        " usr_target/unsafe ".into(),
        RequestInviteRequest {
            request_slot: Some(2),
        },
        " request-image ".into(),
    )
    .unwrap();
    assert_eq!(request_invite.method.as_deref(), Some("POST"));
    assert_eq!(
        request_invite.path.as_deref(),
        Some("requestInvite/usr%5Ftarget%2Funsafe/photo")
    );
    assert!(matches!(
        request_invite.body.as_upload(),
        Some(VrchatUpload::LegacyImage { image_data, .. }) if image_data == "request-image"
    ));
    assert_eq!(
        post_data(&request_invite),
        json!({ "platform": "standalonewindows", "requestSlot": 2 })
    );
}

#[test]
fn required_notification_fields_reject_empty_text() {
    assert!(notification_mark_seen_input(ENDPOINT.into(), " ".into(), "note_1".into(), 2).is_err());
    assert!(notification_mark_seen_input(ENDPOINT.into(), "usr_1".into(), " ".into(), 2).is_err());
    assert!(notification_hide_remote_input(
        ENDPOINT.into(),
        " ".into(),
        2,
        "invite".into(),
        "usr_1".into(),
    )
    .is_err());
    assert!(
        notification_respond_input(ENDPOINT.into(), "note_1".into(), " ".into(), json!({}),)
            .is_err()
    );
    assert!(invite_response_photo_input(ENDPOINT.into(), "note_1".into(), 0, " ".into(),).is_err());
    assert!(invite_photo_input(ENDPOINT.into(), " ".into(), json!({}), "image".into(),).is_err());
    assert!(request_invite_photo_input(
        ENDPOINT.into(),
        "usr_1".into(),
        RequestInviteRequest { request_slot: None },
        " ".into(),
    )
    .is_err());
}

#[test]
fn boop_send_builds_exclusive_emoji_or_inventory_body() {
    let (user_id, request) =
        boop_send_input(ENDPOINT.into(), " usr_1 ".into(), " ".into(), " ".into()).unwrap();
    assert_eq!(user_id, "usr_1");
    assert_eq!(request.method.as_deref(), Some("POST"));
    assert_eq!(request.path.as_deref(), Some("users/usr%5F1/boop"));
    assert_eq!(request.body.as_json(), Some(&json!({})));

    let (_, request) = boop_send_input(
        ENDPOINT.into(),
        "usr_1".into(),
        " default_wave ".into(),
        String::new(),
    )
    .unwrap();
    assert_eq!(
        request.body.as_json(),
        Some(&json!({ "emojiId": "default_wave" }))
    );

    let (_, request) = boop_send_input(
        ENDPOINT.into(),
        "usr_1".into(),
        String::new(),
        " inv_miku ".into(),
    )
    .unwrap();
    assert_eq!(
        request.body.as_json(),
        Some(&json!({ "inventoryItemId": "inv_miku" }))
    );

    assert!(boop_send_input(
        ENDPOINT.into(),
        "usr_1".into(),
        "default_wave".into(),
        "inv_miku".into(),
    )
    .is_err());
    assert!(boop_send_input(ENDPOINT.into(), " ".into(), String::new(), String::new()).is_err());
}

#[test]
fn request_invite_params_reject_unknown_fields() {
    assert!(serde_json::from_value::<RequestInviteRequest>(json!({
        "message": "unsupported",
    }))
    .is_err());
}
