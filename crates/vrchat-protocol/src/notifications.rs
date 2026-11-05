use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{
    api_input, encode_path_segment, get_input, normalize_text, require_text, HttpApiError,
};
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatRequestBody, VrchatUpload};

pub use vrcx_0_contracts::vrchat_requests::RequestInviteRequest;

pub fn notifications_v1_get_input(endpoint: String, n: i32, offset: i32) -> VrchatRequest {
    get_input(
        endpoint,
        "auth/user/notifications",
        HashMap::from([
            ("n".to_string(), json!(n)),
            ("offset".to_string(), json!(offset)),
        ]),
    )
}

pub fn notifications_v2_get_input(endpoint: String, n: i32, offset: i32) -> VrchatRequest {
    get_input(
        endpoint,
        "notifications",
        HashMap::from([
            ("n".to_string(), json!(n)),
            ("offset".to_string(), json!(offset)),
        ]),
    )
}

pub fn hidden_friend_requests_get_input(endpoint: String, n: i32, offset: i32) -> VrchatRequest {
    get_input(
        endpoint,
        "auth/user/notifications",
        HashMap::from([
            ("type".to_string(), json!("friendRequest")),
            ("hidden".to_string(), json!(true)),
            ("n".to_string(), json!(n)),
            ("offset".to_string(), json!(offset)),
        ]),
    )
}

pub fn notification_mark_seen_input(
    endpoint: String,
    user_id: String,
    id: String,
    version: i64,
) -> Result<(String, String, VrchatRequest), HttpApiError> {
    let user_id = require_text(user_id, "VrchatNotificationMarkSeen requires userId.")?;
    let id = require_text(id, "VrchatNotificationMarkSeen requires id.")?;
    let path = if version >= 2 {
        format!("notifications/{}/see", encode_path_segment(&id))
    } else {
        format!("auth/user/notifications/{}/see", encode_path_segment(&id))
    };
    let method = if version >= 2 { "POST" } else { "PUT" };
    Ok((user_id, id, api_input(endpoint, method, path, None)))
}

pub fn notification_accept_friend_request_input(
    endpoint: String,
    id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let id = require_text(id, "VrchatNotificationAcceptFriendRequest requires id.")?;
    Ok((
        id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!(
                "auth/user/notifications/{}/accept",
                encode_path_segment(&id)
            ),
            None,
        ),
    ))
}

pub fn notification_hide_remote_input(
    endpoint: String,
    id: String,
    version: i64,
    type_name: String,
    sender_user_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let id = require_text(id, "VrchatNotificationHideRemote requires id.")?;
    let sender_user_id = normalize_text(sender_user_id);
    let (method, path, body) = if type_name == "ignoredFriendRequest" && !sender_user_id.is_empty()
    {
        (
            "DELETE",
            format!(
                "user/{}/friendRequest",
                encode_path_segment(&sender_user_id)
            ),
            Some(json!({ "notificationId": id })),
        )
    } else if version >= 2 {
        (
            "DELETE",
            format!("notifications/{}", encode_path_segment(&id)),
            None,
        )
    } else {
        (
            "PUT",
            format!("auth/user/notifications/{}/hide", encode_path_segment(&id)),
            None,
        )
    };
    Ok((id, api_input(endpoint, method, path, body)))
}

pub fn notification_respond_input(
    endpoint: String,
    id: String,
    response_type: String,
    response_data: Value,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let id = require_text(id, "VrchatNotificationRespond requires id.")?;
    let response_type = require_text(
        response_type,
        "VrchatNotificationRespond requires responseType.",
    )?;
    Ok((
        id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("notifications/{}/respond", encode_path_segment(&id)),
            Some(json!({
                "notificationId": id,
                "responseType": response_type,
                "responseData": response_data,
            })),
        ),
    ))
}

pub fn invite_response_send_input(
    endpoint: String,
    id: String,
    response_slot: i32,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let id = require_text(id, "VrchatInviteResponseSend requires id.")?;
    Ok((
        id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("invite/{}/response", encode_path_segment(&id)),
            Some(json!({
                "responseSlot": response_slot,
                "rsvp": true,
            })),
        ),
    ))
}

pub fn invite_response_photo_input(
    endpoint: String,
    id: String,
    response_slot: i32,
    image_data: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let id = require_text(id, "VrchatInviteResponsePhotoSend requires id.")?;
    let image_data = require_text(
        image_data,
        "VrchatInviteResponsePhotoSend requires imageData.",
    )?;
    Ok((
        id.clone(),
        VrchatRequest {
            endpoint: Some(endpoint),
            method: Some("POST".into()),
            path: Some(format!(
                "invite/{}/response/photo",
                encode_path_segment(&id)
            )),
            body: VrchatRequestBody::Upload(VrchatUpload::LegacyImage {
                post_data: Some(
                    json!({
                        "responseSlot": response_slot,
                        "rsvp": true,
                    })
                    .to_string(),
                ),
                image_data,
            }),
            ..Default::default()
        },
    ))
}

pub fn invite_send_input(
    endpoint: String,
    receiver_user_id: String,
    params: Value,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let receiver_user_id = require_text(
        receiver_user_id,
        "VrchatInviteSend requires receiverUserId.",
    )?;
    Ok((
        receiver_user_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("invite/{}", encode_path_segment(&receiver_user_id)),
            Some(params),
        ),
    ))
}

pub fn invite_photo_input(
    endpoint: String,
    receiver_user_id: String,
    params: Value,
    image_data: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let receiver_user_id = require_text(
        receiver_user_id,
        "VrchatInvitePhotoSend requires receiverUserId.",
    )?;
    let image_data = require_text(image_data, "VrchatInvitePhotoSend requires imageData.")?;
    let params = if params.is_object() {
        params
    } else {
        json!({})
    };
    Ok((
        receiver_user_id.clone(),
        VrchatRequest {
            endpoint: Some(endpoint),
            method: Some("POST".into()),
            path: Some(format!(
                "invite/{}/photo",
                encode_path_segment(&receiver_user_id)
            )),
            body: VrchatRequestBody::Upload(VrchatUpload::LegacyImage {
                post_data: Some(params.to_string()),
                image_data,
            }),
            ..Default::default()
        },
    ))
}

pub fn request_invite_send_input(
    endpoint: String,
    receiver_user_id: String,
    params: RequestInviteRequest,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let receiver_user_id = require_text(
        receiver_user_id,
        "VrchatRequestInviteSend requires receiverUserId.",
    )?;
    Ok((
        receiver_user_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("requestInvite/{}", encode_path_segment(&receiver_user_id)),
            Some(request_invite_params(params)),
        ),
    ))
}

pub fn request_invite_photo_input(
    endpoint: String,
    receiver_user_id: String,
    params: RequestInviteRequest,
    image_data: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let receiver_user_id = require_text(
        receiver_user_id,
        "VrchatRequestInvitePhotoSend requires receiverUserId.",
    )?;
    let image_data = require_text(
        image_data,
        "VrchatRequestInvitePhotoSend requires imageData.",
    )?;
    Ok((
        receiver_user_id.clone(),
        VrchatRequest {
            endpoint: Some(endpoint),
            method: Some("POST".into()),
            path: Some(format!(
                "requestInvite/{}/photo",
                encode_path_segment(&receiver_user_id)
            )),
            body: VrchatRequestBody::Upload(VrchatUpload::LegacyImage {
                post_data: Some(request_invite_params(params).to_string()),
                image_data,
            }),
            ..Default::default()
        },
    ))
}

fn request_invite_params(params: RequestInviteRequest) -> Value {
    let mut value = json!({ "platform": "standalonewindows" });
    if let Some(request_slot) = params.request_slot {
        value["requestSlot"] = json!(request_slot);
    }
    value
}

pub fn boop_send_input(
    endpoint: String,
    user_id: String,
    emoji_id: String,
    inventory_item_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let user_id = require_text(user_id, "VrchatBoopSend requires userId.")?;
    let emoji_id = normalize_text(emoji_id);
    let inventory_item_id = normalize_text(inventory_item_id);
    let body = match (emoji_id.is_empty(), inventory_item_id.is_empty()) {
        (true, true) => json!({}),
        (false, true) => json!({ "emojiId": emoji_id }),
        (true, false) => json!({ "inventoryItemId": inventory_item_id }),
        (false, false) => {
            return Err(HttpApiError::Custom(
                "VrchatBoopSend accepts either emojiId or inventoryItemId, not both.".into(),
            ))
        }
    };
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("users/{}/boop", encode_path_segment(&user_id)),
            Some(body),
        ),
    ))
}

#[cfg(test)]
mod tests;
