#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendMediaAvatarGalleryImageUploadInput, BackendMediaEntityImageInput,
    BackendMediaFileIdInput, BackendMediaFilePutInput, BackendMediaFileUploadStageInput,
    BackendMediaFileVersionCreateInput, BackendMediaImageUploadInput,
    BackendMediaInventoryItemInput, BackendMediaParamsInput, BackendMediaPrintIdInput,
    BackendMediaPrintUploadInput, BackendMediaPrintsInput, BackendMediaRewardRedeemInput,
    BackendMediaUserInventoryItemInput,
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

fn get_input(
    endpoint: String,
    path: impl Into<String>,
    query_params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some("GET".into()),
        path: Some(path.into()),
        params: Some(query_params.clone()),
        query_params: Some(query_params),
        ..Default::default()
    }
}

fn api_input(
    endpoint: String,
    method: &str,
    path: impl Into<String>,
    body: Option<Value>,
) -> HttpApiRequestInput {
    let has_body = body.is_some();
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path.into()),
        headers: body.as_ref().map(|_| json_headers()),
        body,
        json_body: Some(has_body),
        ..Default::default()
    }
}

fn image_upload_input(
    endpoint: String,
    path: impl Into<String>,
    image_data: String,
    params: HashMap<String, Value>,
    matching_dimensions: bool,
) -> Result<HttpApiRequestInput, AppError> {
    let post_data = serde_json::to_string(&params)
        .map_err(|error| AppError::Custom(format!("serialize media upload params: {error}")))?;
    Ok(HttpApiRequestInput {
        endpoint: Some(endpoint),
        path: Some(path.into()),
        upload_image: Some(true),
        matching_dimensions: Some(matching_dimensions),
        post_data: Some(post_data),
        image_data: Some(image_data),
        ..Default::default()
    })
}

async fn execute_media_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::app__vrchat_media_execute(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_media_files_get(
    state: State<'_, AppState>,
    input: BackendMediaParamsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_media_api(
        state,
        "app__backend_media_files_get",
        "Getting media files.",
        get_input(input.endpoint, "files", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_file_delete(
    state: State<'_, AppState>,
    input: BackendMediaFileIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let file_id = require_text(input.file_id, "BackendMediaFileDelete requires fileId.")?;
    execute_media_api(
        state,
        "app__backend_media_file_delete",
        format!("Deleting media file {file_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("file/{}", encode_path_segment(&file_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_gallery_image_upload(
    state: State<'_, AppState>,
    input: BackendMediaImageUploadInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_media_api(
        state,
        "app__backend_media_gallery_image_upload",
        "Uploading gallery image.",
        image_upload_input(
            input.endpoint,
            "file/image",
            input.image_data,
            HashMap::from([("tag".to_string(), Value::String("gallery".into()))]),
            false,
        )?,
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_avatar_gallery_image_upload(
    state: State<'_, AppState>,
    input: BackendMediaAvatarGalleryImageUploadInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_media_api(
        state,
        "app__backend_media_avatar_gallery_image_upload",
        "Uploading avatar gallery image.",
        image_upload_input(
            input.endpoint,
            "file/image",
            input.image_data,
            HashMap::from([
                ("tag".to_string(), Value::String("avatargallery".into())),
                ("galleryId".to_string(), input.avatar_id),
            ]),
            false,
        )?,
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_vrc_plus_icon_upload(
    state: State<'_, AppState>,
    input: BackendMediaImageUploadInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_media_api(
        state,
        "app__backend_media_vrc_plus_icon_upload",
        "Uploading VRC+ icon.",
        image_upload_input(
            input.endpoint,
            "file/image",
            input.image_data,
            HashMap::from([("tag".to_string(), Value::String("icon".into()))]),
            true,
        )?,
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_emoji_upload(
    state: State<'_, AppState>,
    input: BackendMediaImageUploadInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_media_api(
        state,
        "app__backend_media_emoji_upload",
        "Uploading emoji.",
        image_upload_input(
            input.endpoint,
            "file/image",
            input.image_data,
            input.params,
            true,
        )?,
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_sticker_upload(
    state: State<'_, AppState>,
    input: BackendMediaImageUploadInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_media_api(
        state,
        "app__backend_media_sticker_upload",
        "Uploading sticker.",
        image_upload_input(
            input.endpoint,
            "file/image",
            input.image_data,
            HashMap::from([
                ("tag".to_string(), Value::String("sticker".into())),
                ("maskTag".to_string(), Value::String("square".into())),
            ]),
            true,
        )?,
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_print_upload(
    state: State<'_, AppState>,
    input: BackendMediaPrintUploadInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let post_data = serde_json::to_string(&input.params)
        .map_err(|error| AppError::Custom(format!("serialize print upload params: {error}")))?;
    execute_media_api(
        state,
        "app__backend_media_print_upload",
        "Uploading print.",
        HttpApiRequestInput {
            endpoint: Some(input.endpoint),
            path: Some("prints".into()),
            upload_image_print: Some(true),
            crop_white_border: Some(input.crop_white_border),
            post_data: Some(post_data),
            image_data: Some(input.image_data),
            ..Default::default()
        },
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_prints_get(
    state: State<'_, AppState>,
    input: BackendMediaPrintsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendMediaPrintsGet requires userId.")?;
    execute_media_api(
        state,
        "app__backend_media_prints_get",
        format!("Getting prints for user {user_id}."),
        get_input(
            input.endpoint,
            format!("prints/user/{}", encode_path_segment(&user_id)),
            HashMap::from([("n".to_string(), json!(input.n))]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_print_get(
    state: State<'_, AppState>,
    input: BackendMediaPrintIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let print_id = require_text(input.print_id, "BackendMediaPrintGet requires printId.")?;
    execute_media_api(
        state,
        "app__backend_media_print_get",
        format!("Getting print {print_id}."),
        get_input(
            input.endpoint,
            format!("prints/{}", encode_path_segment(&print_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_print_delete(
    state: State<'_, AppState>,
    input: BackendMediaPrintIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let print_id = require_text(input.print_id, "BackendMediaPrintDelete requires printId.")?;
    execute_media_api(
        state,
        "app__backend_media_print_delete",
        format!("Deleting print {print_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            format!("prints/{}", encode_path_segment(&print_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_inventory_items_get(
    state: State<'_, AppState>,
    input: BackendMediaParamsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_media_api(
        state,
        "app__backend_media_inventory_items_get",
        "Getting inventory items.",
        get_input(input.endpoint, "inventory", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_user_inventory_item_get(
    state: State<'_, AppState>,
    input: BackendMediaUserInventoryItemInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendMediaUserInventoryItemGet requires userId.",
    )?;
    let inventory_id = require_text(
        input.inventory_id,
        "BackendMediaUserInventoryItemGet requires inventoryId.",
    )?;
    execute_media_api(
        state,
        "app__backend_media_user_inventory_item_get",
        format!("Getting inventory item {inventory_id}."),
        get_input(
            input.endpoint,
            format!(
                "user/{}/inventory/{}",
                encode_path_segment(&user_id),
                encode_path_segment(&inventory_id)
            ),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_inventory_item_update(
    state: State<'_, AppState>,
    input: BackendMediaInventoryItemInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let inventory_id = require_text(
        input.inventory_id,
        "BackendMediaInventoryItemUpdate requires inventoryId.",
    )?;
    execute_media_api(
        state,
        "app__backend_media_inventory_item_update",
        format!("Updating inventory item {inventory_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("inventory/{}", encode_path_segment(&inventory_id)),
            Some(Value::Object(input.params.into_iter().collect())),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_inventory_bundle_consume(
    state: State<'_, AppState>,
    input: BackendMediaInventoryItemInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let inventory_id = require_text(
        input.inventory_id,
        "BackendMediaInventoryBundleConsume requires inventoryId.",
    )?;
    execute_media_api(
        state,
        "app__backend_media_inventory_bundle_consume",
        format!("Consuming inventory bundle {inventory_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("inventory/{}/consume", encode_path_segment(&inventory_id)),
            Some(json!({ "inventoryId": inventory_id })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_reward_redeem(
    state: State<'_, AppState>,
    input: BackendMediaRewardRedeemInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let code = require_text(input.code, "BackendMediaRewardRedeem requires code.")?;
    execute_media_api(
        state,
        "app__backend_media_reward_redeem",
        "Redeeming reward.",
        api_input(
            input.endpoint,
            "POST",
            "reward/redeem",
            Some(json!({ "code": code })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_file_version_create(
    state: State<'_, AppState>,
    input: BackendMediaFileVersionCreateInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let file_id = require_text(
        input.file_id,
        "BackendMediaFileVersionCreate requires fileId.",
    )?;
    execute_media_api(
        state,
        "app__backend_media_file_version_create",
        format!("Creating file version for {file_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("file/{}", encode_path_segment(&file_id)),
            Some(json!({
                "fileMd5": input.file_md5,
                "fileSizeInBytes": input.file_size_in_bytes,
                "signatureMd5": input.signature_md5,
                "signatureSizeInBytes": input.signature_size_in_bytes,
            })),
        ),
    )
    .await
}

fn file_upload_stage_path(
    input: BackendMediaFileUploadStageInput,
) -> Result<(String, String), AppError> {
    let file_id = require_text(
        input.file_id,
        "BackendMediaFileUploadStage requires fileId.",
    )?;
    let kind = match normalize_text(input.kind).as_str() {
        "file" => "file".to_string(),
        "signature" => "signature".to_string(),
        _ => {
            return Err(AppError::Custom(
                "unsupported file upload stage kind".into(),
            ))
        }
    };
    Ok((
        input.endpoint,
        format!(
            "file/{}/{}/{}",
            encode_path_segment(&file_id),
            input.version,
            kind
        ),
    ))
}

#[tauri::command]
pub async fn app__backend_media_file_upload_start(
    state: State<'_, AppState>,
    input: BackendMediaFileUploadStageInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let (endpoint, path) = file_upload_stage_path(input)?;
    execute_media_api(
        state,
        "app__backend_media_file_upload_start",
        format!("Starting upload stage {path}."),
        api_input(endpoint, "PUT", format!("{path}/start"), Some(json!({}))),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_file_upload_finish(
    state: State<'_, AppState>,
    input: BackendMediaFileUploadStageInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let (endpoint, path) = file_upload_stage_path(input)?;
    execute_media_api(
        state,
        "app__backend_media_file_upload_finish",
        format!("Finishing upload stage {path}."),
        api_input(
            endpoint,
            "PUT",
            format!("{path}/finish"),
            Some(json!({ "maxParts": 0, "nextPartNumber": 0 })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_file_put(
    state: State<'_, AppState>,
    input: BackendMediaFilePutInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_media_api(
        state,
        "app__backend_media_file_put",
        "Uploading file bytes.",
        HttpApiRequestInput {
            url: Some(input.url),
            upload_file_put: Some(true),
            file_data: Some(input.file_data),
            file_mime: Some(input.file_mime),
            file_md5: Some(input.file_md5),
            ..Default::default()
        },
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_avatar_image_set(
    state: State<'_, AppState>,
    input: BackendMediaEntityImageInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let avatar_id = require_text(
        input.entity_id,
        "BackendMediaAvatarImageSet requires avatarId.",
    )?;
    execute_media_api(
        state,
        "app__backend_media_avatar_image_set",
        format!("Setting avatar image {avatar_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("avatars/{}", encode_path_segment(&avatar_id)),
            Some(json!({ "id": avatar_id, "imageUrl": input.image_url })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_media_world_image_set(
    state: State<'_, AppState>,
    input: BackendMediaEntityImageInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let world_id = require_text(
        input.entity_id,
        "BackendMediaWorldImageSet requires worldId.",
    )?;
    execute_media_api(
        state,
        "app__backend_media_world_image_set",
        format!("Setting world image {world_id}."),
        api_input(
            input.endpoint,
            "PUT",
            format!("worlds/{}", encode_path_segment(&world_id)),
            Some(json!({ "id": world_id, "imageUrl": input.image_url })),
        ),
    )
    .await
}
