#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendAvatarEndpointInput, BackendAvatarFileInput, BackendAvatarIdInput,
    BackendAvatarImpostorCreateInput, BackendAvatarListByUserInput, BackendAvatarModerationInput,
    BackendAvatarSaveInput,
};

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn require_text(value: impl AsRef<str>, message: &str) -> Result<String, AppError> {
    let value = normalize_text(value);
    if value.is_empty() {
        return Err(AppError::Custom(message.into()));
    }
    Ok(value)
}

fn encode_path_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn json_headers() -> HashMap<String, String> {
    HashMap::from([(
        "Content-Type".to_string(),
        "application/json;charset=utf-8".to_string(),
    )])
}

fn object_body(value: Option<Value>) -> Value {
    match value {
        Some(value @ Value::Object(_)) => value,
        _ => json!({}),
    }
}

fn api_input(
    endpoint: String,
    method: &str,
    path: String,
    body: Option<Value>,
) -> HttpApiRequestInput {
    let has_body = body.is_some();
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path),
        headers: body.as_ref().map(|_| json_headers()),
        body,
        json_body: Some(has_body),
        ..Default::default()
    }
}

fn get_input(
    endpoint: String,
    path: String,
    query_params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some("GET".into()),
        path: Some(path),
        params: Some(query_params.clone()),
        query_params: Some(query_params),
        ..Default::default()
    }
}

fn query_input(
    endpoint: String,
    method: &str,
    path: String,
    query_params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path),
        params: Some(query_params.clone()),
        query_params: Some(query_params),
        json_body: Some(false),
        ..Default::default()
    }
}

async fn execute_avatar_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::app__vrchat_avatar_execute(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status))
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_avatar_get(
    state: State<'_, AppState>,
    input: BackendAvatarIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(input.avatar_id, "BackendAvatarGet requires avatarId.")?;
    execute_avatar_api(
        state,
        "app__backend_avatar_get",
        format!("Getting avatar {avatar_id}."),
        get_input(
            input.endpoint,
            format!("avatars/{}", encode_path_segment(&avatar_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_gallery_get(
    state: State<'_, AppState>,
    input: BackendAvatarIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(
        input.avatar_id,
        "BackendAvatarGalleryGet requires avatarId.",
    )?;
    execute_avatar_api(
        state,
        "app__backend_avatar_gallery_get",
        format!("Getting avatar gallery for {avatar_id}."),
        get_input(
            input.endpoint,
            "files".into(),
            HashMap::from([
                ("tag".to_string(), Value::String("avatargallery".into())),
                ("galleryId".to_string(), Value::String(avatar_id)),
                ("n".to_string(), json!(100)),
                ("offset".to_string(), json!(0)),
            ]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_list_by_user_get(
    state: State<'_, AppState>,
    input: BackendAvatarListByUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user = normalize_text(input.user);
    let user_id = normalize_text(input.user_id);
    if user.is_empty() && user_id.is_empty() {
        return Err(AppError::Custom(
            "BackendAvatarListByUserGet requires user or userId.".into(),
        ));
    }
    let mut params = HashMap::from([
        ("n".to_string(), json!(input.n)),
        ("offset".to_string(), json!(input.offset)),
        ("sort".to_string(), Value::String(input.sort)),
        ("order".to_string(), Value::String(input.order)),
        (
            "releaseStatus".to_string(),
            Value::String(input.release_status),
        ),
    ]);
    if user.is_empty() {
        params.insert("userId".to_string(), Value::String(user_id.clone()));
    } else {
        params.insert("user".to_string(), Value::String(user.clone()));
    }
    execute_avatar_api(
        state,
        "app__backend_avatar_list_by_user_get",
        format!(
            "Getting avatars for {}.",
            if user.is_empty() { user_id } else { user }
        ),
        get_input(input.endpoint, "avatars".into(), params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_styles_get(
    state: State<'_, AppState>,
    input: BackendAvatarEndpointInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_avatar_api(
        state,
        "app__backend_avatar_styles_get",
        "Getting avatar styles.",
        get_input(input.endpoint, "avatarStyles".into(), HashMap::new()),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_moderations_get(
    state: State<'_, AppState>,
    input: BackendAvatarEndpointInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_avatar_api(
        state,
        "app__backend_avatar_moderations_get",
        "Getting avatar moderations.",
        get_input(
            input.endpoint,
            "auth/user/avatarmoderations".into(),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_file_get(
    state: State<'_, AppState>,
    input: BackendAvatarFileInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let file_id = require_text(input.file_id, "BackendAvatarFileGet requires fileId.")?;
    execute_avatar_api(
        state,
        "app__backend_avatar_file_get",
        format!("Getting file {file_id}."),
        get_input(
            input.endpoint,
            format!("file/{}", encode_path_segment(&file_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_select(
    state: State<'_, AppState>,
    input: BackendAvatarIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(input.avatar_id, "BackendAvatarSelect requires avatarId.")?;
    execute_avatar_api(
        state,
        "app__backend_avatar_select",
        format!("Selecting avatar {avatar_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("avatars/{}/select", encode_path_segment(&avatar_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_select_fallback(
    state: State<'_, AppState>,
    input: BackendAvatarIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(
        input.avatar_id,
        "BackendAvatarSelectFallback requires avatarId.",
    )?;
    execute_avatar_api(
        state,
        "app__backend_avatar_select_fallback",
        format!("Selecting fallback avatar {avatar_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("avatars/{}/selectfallback", encode_path_segment(&avatar_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_save(
    state: State<'_, AppState>,
    input: BackendAvatarSaveInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(input.avatar_id, "BackendAvatarSave requires avatarId.")?;
    execute_avatar_api(
        state,
        "app__backend_avatar_save",
        format!("Saving avatar {avatar_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("avatars/{}", encode_path_segment(&avatar_id)),
            Some(object_body(input.params)),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_delete(
    state: State<'_, AppState>,
    input: BackendAvatarIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(input.avatar_id, "BackendAvatarDelete requires avatarId.")?;
    execute_avatar_api(
        state,
        "app__backend_avatar_delete",
        format!("Deleting avatar {avatar_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("avatars/{}", encode_path_segment(&avatar_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_impostor_create(
    state: State<'_, AppState>,
    input: BackendAvatarImpostorCreateInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(
        input.avatar_id,
        "BackendAvatarImpostorCreate requires avatarId.",
    )?;
    let body = input.empty_body.then(|| json!({}));
    execute_avatar_api(
        state,
        "app__backend_avatar_impostor_create",
        format!("Creating avatar impostor for {avatar_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!(
                "avatars/{}/impostor/enqueue",
                encode_path_segment(&avatar_id)
            ),
            body,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_impostor_delete(
    state: State<'_, AppState>,
    input: BackendAvatarIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(
        input.avatar_id,
        "BackendAvatarImpostorDelete requires avatarId.",
    )?;
    execute_avatar_api(
        state,
        "app__backend_avatar_impostor_delete",
        format!("Deleting avatar impostor for {avatar_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("avatars/{}/impostor", encode_path_segment(&avatar_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_moderation_send(
    state: State<'_, AppState>,
    input: BackendAvatarModerationInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(
        input.avatar_id,
        "BackendAvatarModerationSend requires avatarId.",
    )?;
    let type_name = normalize_text(input.type_name);
    let type_name = if type_name.is_empty() {
        "block".to_string()
    } else {
        type_name
    };
    execute_avatar_api(
        state,
        "app__backend_avatar_moderation_send",
        format!("Sending avatar moderation {type_name} for {avatar_id}."),
        api_input(
            input.endpoint,
            "POST",
            "auth/user/avatarmoderations".into(),
            Some(json!({
                "avatarModerationType": type_name,
                "targetAvatarId": avatar_id,
            })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_avatar_moderation_delete(
    state: State<'_, AppState>,
    input: BackendAvatarModerationInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(
        input.avatar_id,
        "BackendAvatarModerationDelete requires avatarId.",
    )?;
    let type_name = normalize_text(input.type_name);
    let type_name = if type_name.is_empty() {
        "block".to_string()
    } else {
        type_name
    };
    execute_avatar_api(
        state,
        "app__backend_avatar_moderation_delete",
        format!("Deleting avatar moderation {type_name} for {avatar_id}."),
        query_input(
            input.endpoint,
            "DELETE",
            "auth/user/avatarmoderations".into(),
            HashMap::from([
                ("avatarModerationType".to_string(), Value::String(type_name)),
                ("targetAvatarId".to_string(), Value::String(avatar_id)),
            ]),
        ),
    )
    .await
}
