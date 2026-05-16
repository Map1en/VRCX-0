#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;
use vrcx_0_persistence::common::ParamsBuilder;

use crate::api::app::local_data::types::ConfigWriteEntry;
use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendFavoriteAddInput, BackendFavoriteDeleteInput, BackendFavoriteGroupClearInput,
    BackendFavoriteGroupSaveInput, BackendLocalFavoriteGroupInput,
    BackendLocalFavoriteGroupRenameInput, BackendLocalFavoriteInput,
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

fn favorite_api_input(
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

async fn execute_favorite_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::app__vrchat_favorite_execute(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
        }
    }
    result
}

fn normalize_config_key(key: &str) -> String {
    let key = key.trim();
    if key.starts_with("config:") {
        return key.to_string();
    }
    let stripped = key.strip_prefix("VRCX_").unwrap_or(key);
    format!("config:vrcx_{}", stripped.to_ascii_lowercase())
}

fn local_group_config_key(kind: &str) -> Result<&'static str, AppError> {
    match kind.trim() {
        "friend" => Ok("localFavoriteFriendGroups"),
        "avatar" => Ok("localFavoriteAvatarGroups"),
        "world" => Ok("localFavoriteWorldGroups"),
        _ => Err(AppError::Custom("unsupported favorite kind".into())),
    }
}

fn read_config_array(state: &State<'_, AppState>, key: &str) -> Result<Vec<String>, AppError> {
    super::super::local_data::app__config_set_values(state.clone(), Vec::new())?;
    let normalized_key = normalize_config_key(key);
    let Some(row) = state
        .db
        .execute(
            "SELECT value FROM configs WHERE key = @key LIMIT 1",
            &ParamsBuilder::new().set("key", normalized_key).build(),
        )?
        .first()
        .cloned()
    else {
        return Ok(Vec::new());
    };

    let text = row.first().map(value_as_string).unwrap_or_default();
    let parsed = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
    let mut values = parsed
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(value_as_string)
                .map(normalize_text)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    values.sort();
    values.dedup();
    Ok(values)
}

fn value_as_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

fn write_config_array(
    state: State<'_, AppState>,
    key: &str,
    values: Vec<String>,
) -> Result<(), AppError> {
    let value = serde_json::to_string(&values)
        .map_err(|error| AppError::Custom(format!("serialize config array: {error}")))?;
    super::super::local_data::app__config_set_values(
        state,
        vec![ConfigWriteEntry {
            key: key.into(),
            value,
        }],
    )
}

fn add_group_value(groups: &mut Vec<String>, group_name: String) {
    if !groups.iter().any(|value| value == &group_name) {
        groups.push(group_name);
    }
    groups.sort();
    groups.dedup();
}

#[tauri::command]
pub async fn app__backend_favorite_add(
    state: State<'_, AppState>,
    input: BackendFavoriteAddInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let type_name = require_text(input.type_name, "BackendFavoriteAdd requires type.")?;
    let favorite_id = require_text(input.favorite_id, "BackendFavoriteAdd requires favoriteId.")?;
    let tags = require_text(input.tags, "BackendFavoriteAdd requires tags.")?;
    execute_favorite_api(
        state,
        "app__backend_favorite_add",
        format!("Adding {type_name} favorite {favorite_id}."),
        favorite_api_input(
            input.endpoint,
            "POST",
            "favorites".into(),
            Some(json!({
                "type": type_name,
                "favoriteId": favorite_id,
                "tags": tags,
            })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_favorite_delete(
    state: State<'_, AppState>,
    input: BackendFavoriteDeleteInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let object_id = require_text(input.object_id, "BackendFavoriteDelete requires objectId.")?;
    execute_favorite_api(
        state,
        "app__backend_favorite_delete",
        format!("Deleting favorite for {object_id}."),
        favorite_api_input(
            input.endpoint,
            "DELETE",
            format!("favorites/{}", encode_path_segment(&object_id)),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_favorite_group_save(
    state: State<'_, AppState>,
    input: BackendFavoriteGroupSaveInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let owner_id = require_text(input.owner_id, "BackendFavoriteGroupSave requires ownerId.")?;
    let type_name = require_text(input.type_name, "BackendFavoriteGroupSave requires type.")?;
    let group = require_text(input.group, "BackendFavoriteGroupSave requires group.")?;
    let mut body = json!({
        "type": type_name,
        "group": group,
    });
    if let Some(display_name) = input.display_name {
        body["displayName"] = Value::String(display_name);
    }
    if let Some(visibility) = input.visibility {
        body["visibility"] = Value::String(visibility);
    }

    execute_favorite_api(
        state,
        "app__backend_favorite_group_save",
        format!("Saving favorite group {group}."),
        favorite_api_input(
            input.endpoint,
            "PUT",
            format!(
                "favorite/group/{}/{}/{}",
                encode_path_segment(&type_name),
                encode_path_segment(&group),
                encode_path_segment(&owner_id)
            ),
            Some(body),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_favorite_group_clear(
    state: State<'_, AppState>,
    input: BackendFavoriteGroupClearInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let owner_id = require_text(
        input.owner_id,
        "BackendFavoriteGroupClear requires ownerId.",
    )?;
    let type_name = require_text(input.type_name, "BackendFavoriteGroupClear requires type.")?;
    let group = require_text(input.group, "BackendFavoriteGroupClear requires group.")?;
    execute_favorite_api(
        state,
        "app__backend_favorite_group_clear",
        format!("Clearing favorite group {group}."),
        favorite_api_input(
            input.endpoint,
            "DELETE",
            format!(
                "favorite/group/{}/{}/{}",
                encode_path_segment(&type_name),
                encode_path_segment(&group),
                encode_path_segment(&owner_id)
            ),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub fn app__backend_local_favorite_add(
    state: State<'_, AppState>,
    input: BackendLocalFavoriteInput,
) -> Result<i64, AppError> {
    let kind = require_text(input.kind, "BackendLocalFavoriteAdd requires kind.")?;
    let entity_id = require_text(
        input.entity_id,
        "BackendLocalFavoriteAdd requires entityId.",
    )?;
    let group_name = require_text(
        input.group_name,
        "BackendLocalFavoriteAdd requires groupName.",
    )?;
    super::super::local_data::app__favorite_add(state, kind, entity_id, group_name)
}

#[tauri::command]
pub fn app__backend_local_favorite_remove(
    state: State<'_, AppState>,
    input: BackendLocalFavoriteInput,
) -> Result<i64, AppError> {
    let kind = require_text(input.kind, "BackendLocalFavoriteRemove requires kind.")?;
    let entity_id = require_text(
        input.entity_id,
        "BackendLocalFavoriteRemove requires entityId.",
    )?;
    let group_name = require_text(
        input.group_name,
        "BackendLocalFavoriteRemove requires groupName.",
    )?;
    super::super::local_data::app__favorite_remove(state, kind, entity_id, group_name)
}

#[tauri::command]
pub fn app__backend_local_favorite_group_create(
    state: State<'_, AppState>,
    input: BackendLocalFavoriteGroupInput,
) -> Result<(), AppError> {
    let kind = require_text(input.kind, "BackendLocalFavoriteGroupCreate requires kind.")?;
    let group_name = require_text(
        input.group_name,
        "BackendLocalFavoriteGroupCreate requires groupName.",
    )?;
    let key = local_group_config_key(&kind)?;
    let mut groups = read_config_array(&state, key)?;
    add_group_value(&mut groups, group_name);
    write_config_array(state, key, groups)
}

#[tauri::command]
pub fn app__backend_local_favorite_group_rename(
    state: State<'_, AppState>,
    input: BackendLocalFavoriteGroupRenameInput,
) -> Result<i64, AppError> {
    let kind = require_text(input.kind, "BackendLocalFavoriteGroupRename requires kind.")?;
    let group_name = require_text(
        input.group_name,
        "BackendLocalFavoriteGroupRename requires groupName.",
    )?;
    let new_group_name = require_text(
        input.new_group_name,
        "BackendLocalFavoriteGroupRename requires newGroupName.",
    )?;
    let key = local_group_config_key(&kind)?;
    let result = super::super::local_data::app__favorite_group_rename(
        state.clone(),
        kind,
        group_name.clone(),
        new_group_name.clone(),
    )?;
    let mut groups = read_config_array(&state, key)?
        .into_iter()
        .filter(|value| value != &group_name)
        .collect::<Vec<_>>();
    add_group_value(&mut groups, new_group_name);
    write_config_array(state, key, groups)?;
    Ok(result)
}

#[tauri::command]
pub fn app__backend_local_favorite_group_delete(
    state: State<'_, AppState>,
    input: BackendLocalFavoriteGroupInput,
) -> Result<i64, AppError> {
    let kind = require_text(input.kind, "BackendLocalFavoriteGroupDelete requires kind.")?;
    let group_name = require_text(
        input.group_name,
        "BackendLocalFavoriteGroupDelete requires groupName.",
    )?;
    let key = local_group_config_key(&kind)?;
    let result = super::super::local_data::app__favorite_group_delete(
        state.clone(),
        kind,
        group_name.clone(),
    )?;
    let groups = read_config_array(&state, key)?
        .into_iter()
        .filter(|value| value != &group_name)
        .collect::<Vec<_>>();
    write_config_array(state, key, groups)?;
    Ok(result)
}
