use serde_json::{json, Value};

use super::*;

const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

fn post_data(request: &HttpApiRequestInput) -> Value {
    serde_json::from_str(request.post_data.as_deref().unwrap()).unwrap()
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
    assert_eq!(request.body, Some(json!({ "notificationId": "note_1" })));
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
    assert!(v1.body.is_none());

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
    assert!(v2.body.is_none());
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
        request.body,
        Some(json!({
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
    assert_eq!(request.upload_image_legacy, Some(true));
    assert_eq!(request.image_data.as_deref(), Some("image-data"));
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
    assert_eq!(invite.upload_image_legacy, Some(true));
    assert_eq!(invite.image_data.as_deref(), Some("invite-image"));
    assert_eq!(post_data(&invite), params);

    let (_, request_invite) = request_invite_photo_input(
        ENDPOINT.into(),
        " usr_target/unsafe ".into(),
        json!({ "message": "please" }),
        " request-image ".into(),
    )
    .unwrap();
    assert_eq!(request_invite.method.as_deref(), Some("POST"));
    assert_eq!(
        request_invite.path.as_deref(),
        Some("requestInvite/usr%5Ftarget%2Funsafe/photo")
    );
    assert_eq!(request_invite.upload_image_legacy, Some(true));
    assert_eq!(request_invite.image_data.as_deref(), Some("request-image"));
    assert_eq!(post_data(&request_invite), json!({ "message": "please" }));
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
    assert!(
        request_invite_photo_input(ENDPOINT.into(), "usr_1".into(), json!({}), " ".into(),)
            .is_err()
    );
}
