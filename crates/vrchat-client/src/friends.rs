use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{
    api_input, encode_path_segment, get_input, normalize_text, require_text, HttpApiError,
    HttpApiRequestInput,
};

pub fn friends_get_input(
    endpoint: String,
    offline: bool,
    n: i64,
    offset: i64,
) -> HttpApiRequestInput {
    get_input(
        endpoint,
        "auth/user/friends",
        HashMap::from([
            ("offline".to_string(), Value::Bool(offline)),
            ("n".to_string(), json!(n)),
            ("offset".to_string(), json!(offset)),
        ]),
    )
}

pub fn friend_status_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatFriendStatusGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("user/{}/friendStatus", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn friend_delete_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatFriendDelete requires userId.")?;
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("auth/user/friends/{}", encode_path_segment(&user_id)),
            None,
        ),
    ))
}

pub fn friend_request_send_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatFriendRequestSend requires userId.")?;
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("user/{}/friendRequest", encode_path_segment(&user_id)),
            None,
        ),
    ))
}

pub fn friend_request_cancel_input(
    endpoint: String,
    user_id: String,
    notification_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatFriendRequestCancel requires userId.")?;
    let notification_id = normalize_text(notification_id);
    let body = if notification_id.is_empty() {
        None
    } else {
        Some(json!({ "notificationId": notification_id }))
    };
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("user/{}/friendRequest", encode_path_segment(&user_id)),
            body,
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

    #[test]
    fn friend_list_keeps_original_route_and_pagination_contract() {
        let request = friends_get_input(ENDPOINT.into(), true, 100, 200);

        assert_eq!(request.method.as_deref(), Some("GET"));
        assert_eq!(request.path.as_deref(), Some("auth/user/friends"));
        assert_eq!(
            request.query_params,
            Some(HashMap::from([
                ("offline".to_string(), json!(true)),
                ("n".to_string(), json!(100)),
                ("offset".to_string(), json!(200)),
            ]))
        );
    }

    #[test]
    fn friend_mutations_keep_methods_and_encode_user_ids() {
        let (_, status) =
            friend_status_get_input(ENDPOINT.into(), " usr_1/unsafe ".into()).unwrap();
        assert_eq!(status.method.as_deref(), Some("GET"));
        assert_eq!(
            status.path.as_deref(),
            Some("user/usr%5F1%2Funsafe/friendStatus")
        );

        let (_, delete) = friend_delete_input(ENDPOINT.into(), " usr_1/unsafe ".into()).unwrap();
        assert_eq!(delete.method.as_deref(), Some("DELETE"));
        assert_eq!(
            delete.path.as_deref(),
            Some("auth/user/friends/usr%5F1%2Funsafe")
        );

        let (_, send) =
            friend_request_send_input(ENDPOINT.into(), " usr_1/unsafe ".into()).unwrap();
        assert_eq!(send.method.as_deref(), Some("POST"));
        assert_eq!(
            send.path.as_deref(),
            Some("user/usr%5F1%2Funsafe/friendRequest")
        );
    }

    #[test]
    fn friend_request_cancel_only_sends_notification_body_when_present() {
        let (_, without_notification) =
            friend_request_cancel_input(ENDPOINT.into(), "usr_1".into(), " ".into()).unwrap();
        assert_eq!(without_notification.method.as_deref(), Some("DELETE"));
        assert_eq!(
            without_notification.body,
            crate::http_api::HttpApiRequestBody::Empty
        );

        let (_, with_notification) =
            friend_request_cancel_input(ENDPOINT.into(), "usr_1".into(), " note_1 ".into())
                .unwrap();
        assert_eq!(
            with_notification.body.as_json(),
            Some(&json!({ "notificationId": "note_1" }))
        );
    }

    #[test]
    fn friend_id_routes_reject_blank_ids() {
        assert!(friend_status_get_input(ENDPOINT.into(), " ".into()).is_err());
        assert!(friend_delete_input(ENDPOINT.into(), " ".into()).is_err());
        assert!(friend_request_send_input(ENDPOINT.into(), " ".into()).is_err());
        assert!(friend_request_cancel_input(ENDPOINT.into(), " ".into(), "note_1".into()).is_err());
    }
}
