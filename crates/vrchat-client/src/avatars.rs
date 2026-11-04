use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{
    api_input, encode_path_segment, get_input, normalize_text, query_input, require_text,
    HttpApiError,
};
use crate::query::{AvatarListSort, QueryOrder, ReleaseStatusFilter};
use vrcx_0_contracts::vrchat_api::VrchatRequest;

pub use vrcx_0_contracts::vrchat_requests::{AvatarReleaseStatus, AvatarUpdateRequest};

pub fn avatar_get_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarGet requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        get_input(
            endpoint,
            format!("avatars/{}", encode_path_segment(&avatar_id)),
            HashMap::new(),
        ),
    ))
}

pub fn avatar_gallery_get_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarGalleryGet requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        get_input(
            endpoint,
            "files",
            HashMap::from([
                ("tag".to_string(), Value::String("avatargallery".into())),
                ("galleryId".to_string(), Value::String(avatar_id)),
                ("n".to_string(), json!(100)),
                ("offset".to_string(), json!(0)),
            ]),
        ),
    ))
}

pub struct AvatarListByUserGetInput {
    pub endpoint: String,
    pub user_id: String,
    pub user: String,
    pub n: i32,
    pub offset: i32,
    pub sort: AvatarListSort,
    pub order: QueryOrder,
    pub release_status: ReleaseStatusFilter,
}

pub fn avatar_list_by_user_get_input(
    input: AvatarListByUserGetInput,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let user = normalize_text(input.user);
    let user_id = normalize_text(input.user_id);
    if user.is_empty() && user_id.is_empty() {
        return Err(HttpApiError::Custom(
            "VrchatAvatarListByUserGet requires user or userId.".into(),
        ));
    }
    let mut params = HashMap::from([
        ("n".to_string(), json!(input.n)),
        ("offset".to_string(), json!(input.offset)),
        (
            "sort".to_string(),
            Value::String(input.sort.as_str().into()),
        ),
        (
            "order".to_string(),
            Value::String(input.order.as_str().into()),
        ),
        (
            "releaseStatus".to_string(),
            Value::String(input.release_status.as_str().into()),
        ),
    ]);
    let display = if user.is_empty() {
        params.insert("userId".to_string(), Value::String(user_id.clone()));
        user_id
    } else {
        params.insert("user".to_string(), Value::String(user.clone()));
        user
    };
    Ok((display, get_input(input.endpoint, "avatars", params)))
}

pub fn avatar_styles_get_input(endpoint: String) -> VrchatRequest {
    get_input(endpoint, "avatarStyles", HashMap::new())
}

pub fn avatar_moderations_get_input(endpoint: String) -> VrchatRequest {
    get_input(endpoint, "auth/user/avatarmoderations", HashMap::new())
}

pub fn avatar_file_get_input(
    endpoint: String,
    file_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let file_id = require_text(file_id, "VrchatAvatarFileGet requires fileId.")?;
    Ok((
        file_id.clone(),
        get_input(
            endpoint,
            format!("file/{}", encode_path_segment(&file_id)),
            HashMap::new(),
        ),
    ))
}

pub fn avatar_select_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarSelect requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!("avatars/{}/select", encode_path_segment(&avatar_id)),
            Some(json!({ "avatarId": avatar_id })),
        ),
    ))
}

pub fn avatar_select_fallback_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarSelectFallback requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!("avatars/{}/selectfallback", encode_path_segment(&avatar_id)),
            Some(json!({ "avatarId": avatar_id })),
        ),
    ))
}

pub fn avatar_save_input(
    endpoint: String,
    avatar_id: String,
    params: AvatarUpdateRequest,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarSave requires avatarId.")?;
    if params.id != avatar_id {
        return Err(HttpApiError::Custom(
            "VrchatAvatarSave params.id must match avatarId.".into(),
        ));
    }
    Ok((
        avatar_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!("avatars/{}", encode_path_segment(&avatar_id)),
            Some(json!(params)),
        ),
    ))
}

pub fn avatar_delete_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarDelete requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("avatars/{}", encode_path_segment(&avatar_id)),
            None,
        ),
    ))
}

pub fn avatar_impostor_create_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarImpostorCreate requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!(
                "avatars/{}/impostor/enqueue",
                encode_path_segment(&avatar_id)
            ),
            Some(json!({})),
        ),
    ))
}

pub fn avatar_impostor_delete_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarImpostorDelete requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("avatars/{}/impostor", encode_path_segment(&avatar_id)),
            None,
        ),
    ))
}

pub fn avatar_moderation_send_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarModerationSend requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        api_input(
            endpoint,
            "POST",
            "auth/user/avatarmoderations",
            Some(json!({
                "avatarModerationType": "block",
                "targetAvatarId": avatar_id,
            })),
        ),
    ))
}

pub fn avatar_moderation_delete_input(
    endpoint: String,
    avatar_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let avatar_id = require_text(avatar_id, "VrchatAvatarModerationDelete requires avatarId.")?;
    Ok((
        avatar_id.clone(),
        query_input(
            endpoint,
            "DELETE",
            "auth/user/avatarmoderations",
            HashMap::from([
                (
                    "avatarModerationType".to_string(),
                    Value::String("block".into()),
                ),
                ("targetAvatarId".to_string(), Value::String(avatar_id)),
            ]),
        ),
    ))
}

#[cfg(test)]
mod tests;
