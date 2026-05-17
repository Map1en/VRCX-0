#![allow(non_snake_case)]

use std::collections::HashMap;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use vrcx_0_vrchat::http_api::normalize_vrchat_api_endpoint;

use crate::api::app::vrchat_api_types::HttpApiRequestInput;
use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_store::local_moderation::{
    LocalModerationInput, LocalModerationOutput, RemoteModerationInput,
};

const PLAYER_MODERATIONS_PATH: &str = "auth/user/playermoderations";
const PLAYER_MODERATION_DELETE_PATH: &str = "auth/user/unplayermoderate";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendModerationRefreshInput {
    user_id: String,
    #[serde(default)]
    endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendModerationMutationInput {
    #[serde(default)]
    owner_user_id: String,
    #[serde(default)]
    endpoint: String,
    target_user_id: String,
    #[serde(default)]
    target_display_name: String,
    r#type: String,
    enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendModerationRefreshOutput {
    accepted: bool,
    user_id: String,
    remote_count: usize,
    local_count: usize,
    rows: Vec<BackendRemoteModerationRow>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendRemoteModerationRow {
    id: String,
    r#type: String,
    source_user_id: String,
    source_display_name: String,
    target_user_id: String,
    target_display_name: String,
    created: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendModerationMutationOutput {
    target_user_id: String,
    r#type: String,
    enabled: bool,
    local: Option<LocalModerationOutput>,
}

impl BackendRemoteModerationRow {
    fn to_local_input(&self) -> RemoteModerationInput {
        RemoteModerationInput {
            r#type: self.r#type.clone(),
            target_user_id: self.target_user_id.clone(),
            target_display_name: self.target_display_name.clone(),
            created: self.created.clone(),
        }
    }
}

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_scope_endpoint(value: &str) -> String {
    normalize_endpoint(value)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn value_as_normalized_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => normalize_text(value),
        Some(Value::Null) | None => String::new(),
        Some(value) => normalize_text(value.to_string()),
    }
}

fn value_as_string_or_empty(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn normalize_endpoint(endpoint: &str) -> String {
    normalize_vrchat_api_endpoint(Some(endpoint))
}

async fn execute_vrchat_json_request(
    state: &State<'_, AppState>,
    endpoint: &str,
    path: &str,
    method: &str,
    body: Option<Value>,
) -> Result<Value, AppError> {
    let has_body = body.is_some();
    let response = super::vrchat_api::execute_vrchat_tools_api(
        state.clone(),
        HttpApiRequestInput {
            endpoint: Some(normalize_endpoint(endpoint)),
            method: Some(method.to_string()),
            path: Some(path.to_string()),
            headers: has_body.then(|| {
                HashMap::from([(
                    "Content-Type".to_string(),
                    "application/json;charset=utf-8".to_string(),
                )])
            }),
            body,
            json_body: Some(has_body),
            ..Default::default()
        },
    )
    .await?;

    let json = parse_response_json(&response.data);
    if response.status >= 400 || response_has_error(&json) {
        return Err(AppError::Custom(unwrap_error_message(
            &json,
            response.status,
        )));
    }

    Ok(json)
}

fn parse_response_json(data: &str) -> Value {
    serde_json::from_str(data).unwrap_or_else(|_| Value::String(data.to_string()))
}

fn response_has_error(json: &Value) -> bool {
    json.as_object()
        .is_some_and(|object| object.contains_key("error"))
}

fn value_message(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(|message| message.trim_matches('"').to_string())
}

fn unwrap_error_message(json: &Value, status: i32) -> String {
    if let Some(message) = value_message(Some(json)) {
        return message;
    }

    let object = json.as_object();
    if let Some(message) = value_message(
        object
            .and_then(|record| record.get("error"))
            .and_then(Value::as_object)
            .and_then(|error| error.get("message")),
    ) {
        return message;
    }
    if let Some(message) = value_message(object.and_then(|record| record.get("message"))) {
        return message;
    }

    format!("VRChat moderation request failed ({status})")
}

fn normalize_remote_moderation_row(row: &Value) -> Option<BackendRemoteModerationRow> {
    let record = row.as_object()?;
    let id = value_as_normalized_text(record.get("id"));
    let r#type = value_as_normalized_text(record.get("type"));
    let source_user_id = value_as_normalized_text(record.get("sourceUserId"));
    let target_user_id = value_as_normalized_text(record.get("targetUserId"));

    if id.is_empty() || r#type.is_empty() || target_user_id.is_empty() {
        return None;
    }

    Some(BackendRemoteModerationRow {
        id,
        r#type,
        source_user_id,
        source_display_name: value_as_string_or_empty(record.get("sourceDisplayName")),
        target_user_id,
        target_display_name: value_as_string_or_empty(record.get("targetDisplayName")),
        created: value_as_string_or_empty(record.get("created")),
    })
}

fn normalize_remote_moderation_rows(json: &Value) -> Vec<BackendRemoteModerationRow> {
    json.as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(normalize_remote_moderation_row)
                .collect()
        })
        .unwrap_or_default()
}

async fn fetch_remote_moderations(
    state: &State<'_, AppState>,
    endpoint: &str,
) -> Result<(usize, Vec<BackendRemoteModerationRow>), AppError> {
    let json =
        execute_vrchat_json_request(state, endpoint, PLAYER_MODERATIONS_PATH, "GET", None).await?;
    let remote_count = json.as_array().map_or(0, Vec::len);
    Ok((remote_count, normalize_remote_moderation_rows(&json)))
}

fn is_local_player_moderation_type(r#type: &str) -> bool {
    r#type == "block" || r#type == "mute"
}

fn rows_have_verified_owner(rows: &[BackendRemoteModerationRow], user_id: &str) -> bool {
    !rows.is_empty()
        && rows
            .iter()
            .all(|row| !row.source_user_id.is_empty() && row.source_user_id == user_id)
}

fn backend_auth_scope_matches(state: &State<'_, AppState>, user_id: &str, endpoint: &str) -> bool {
    let snapshot = state.backend_context.session.snapshot();
    let Some(context) = snapshot.realtime_context else {
        return false;
    };

    context.current_user_id == user_id
        && normalize_scope_endpoint(&context.endpoint) == normalize_scope_endpoint(endpoint)
}

fn should_write_refresh_snapshot(
    state: &State<'_, AppState>,
    user_id: &str,
    endpoint: &str,
    rows: &[BackendRemoteModerationRow],
) -> bool {
    let auth_scope = state.backend_context.auth_scope.snapshot();
    if auth_scope.active {
        return state.backend_context.auth_scope.matches(user_id, endpoint);
    }

    backend_auth_scope_matches(state, user_id, endpoint) || rows_have_verified_owner(rows, user_id)
}

fn ensure_current_auth_scope(
    state: &State<'_, AppState>,
    user_id: &str,
    endpoint: &str,
) -> Result<(), AppError> {
    if state.backend_context.auth_scope.matches(user_id, endpoint) {
        return Ok(());
    }

    Err(AppError::Custom(
        "Backend moderation request is stale for the current auth scope.".into(),
    ))
}

fn resolve_local_moderation_state(
    existing: Option<&LocalModerationOutput>,
    r#type: &str,
    enabled: bool,
) -> (bool, bool) {
    let block = if r#type == "block" {
        enabled
    } else {
        existing.is_some_and(|entry| entry.block)
    };
    let mute = if r#type == "mute" {
        enabled
    } else {
        existing.is_some_and(|entry| entry.mute)
    };

    (block, mute)
}

async fn refresh_player_moderations(
    state: State<'_, AppState>,
    input: BackendModerationRefreshInput,
) -> Result<BackendModerationRefreshOutput, AppError> {
    let user_id = normalize_text(input.user_id);
    if user_id.is_empty() {
        return Ok(BackendModerationRefreshOutput {
            accepted: false,
            user_id,
            remote_count: 0,
            local_count: 0,
            rows: Vec::new(),
        });
    }

    let (remote_count, rows) = fetch_remote_moderations(&state, &input.endpoint).await?;
    let accepted = should_write_refresh_snapshot(&state, &user_id, &input.endpoint, &rows);
    let local_count = if accepted {
        let local_inputs: Vec<RemoteModerationInput> = rows
            .iter()
            .map(BackendRemoteModerationRow::to_local_input)
            .collect();
        super::local_moderation::app__local_moderation_sync_snapshot(
            state,
            user_id.clone(),
            local_inputs,
        )?
        .len()
    } else {
        0
    };

    Ok(BackendModerationRefreshOutput {
        accepted,
        user_id,
        remote_count,
        local_count,
        rows,
    })
}

async fn update_player_moderation(
    state: State<'_, AppState>,
    input: BackendModerationMutationInput,
) -> Result<BackendModerationMutationOutput, AppError> {
    let owner_user_id = normalize_text(input.owner_user_id);
    let target_user_id = normalize_text(input.target_user_id);
    let target_display_name = input.target_display_name.clone();
    let r#type = normalize_text(input.r#type);
    if owner_user_id.is_empty() || target_user_id.is_empty() || r#type.is_empty() {
        return Err(AppError::Custom(
            "BackendModerationUpdate requires ownerUserId, targetUserId and type.".into(),
        ));
    }
    ensure_current_auth_scope(&state, &owner_user_id, &input.endpoint)?;

    let path = if input.enabled {
        PLAYER_MODERATIONS_PATH
    } else {
        PLAYER_MODERATION_DELETE_PATH
    };
    let method = if input.enabled { "POST" } else { "PUT" };
    execute_vrchat_json_request(
        &state,
        &input.endpoint,
        path,
        method,
        Some(json!({
            "moderated": target_user_id.clone(),
            "type": r#type.clone(),
        })),
    )
    .await?;

    let local = if is_local_player_moderation_type(&r#type) {
        let existing = super::local_moderation::app__local_moderation_get(
            state.clone(),
            owner_user_id.clone(),
            target_user_id.clone(),
        )?;
        let (block, mute) =
            resolve_local_moderation_state(existing.as_ref(), &r#type, input.enabled);
        let updated_at = now_iso();
        if block || mute {
            super::local_moderation::app__local_moderation_set(
                state,
                owner_user_id,
                LocalModerationInput {
                    user_id: target_user_id.clone(),
                    updated_at: updated_at.clone(),
                    display_name: target_display_name.clone(),
                    block,
                    mute,
                },
            )?;
            Some(LocalModerationOutput {
                user_id: target_user_id.clone(),
                updated_at,
                display_name: target_display_name.clone(),
                block,
                mute,
            })
        } else {
            super::local_moderation::app__local_moderation_delete(
                state,
                owner_user_id,
                target_user_id.clone(),
            )?;
            Some(LocalModerationOutput {
                user_id: target_user_id.clone(),
                updated_at,
                display_name: target_display_name.clone(),
                block: false,
                mute: false,
            })
        }
    } else {
        None
    };

    Ok(BackendModerationMutationOutput {
        target_user_id,
        r#type,
        enabled: input.enabled,
        local,
    })
}

#[tauri::command]
pub async fn app__backend_moderation_refresh(
    state: State<'_, AppState>,
    input: BackendModerationRefreshInput,
) -> Result<BackendModerationRefreshOutput, AppError> {
    let command = "app__backend_moderation_refresh";
    let diagnostics = state.backend_context.diagnostics.clone();
    let sync = state.backend_context.sync.clone();
    diagnostics.record_command(command, "running", "Moderation snapshot refresh started.");

    let result = refresh_player_moderations(state, input).await;
    match &result {
        Ok(output) => {
            diagnostics.record_command(
                command,
                "ok",
                format!(
                    "user={} remote={} local={}",
                    output.user_id, output.remote_count, output.local_count
                ),
            );
            sync.record(
                "moderation",
                "ready",
                format!(
                    "Moderation snapshot refreshed for {} with {} local rows.",
                    output.user_id, output.local_count
                ),
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("moderation", error.to_string());
        }
    }

    result
}

#[tauri::command]
pub async fn app__backend_moderation_update(
    state: State<'_, AppState>,
    input: BackendModerationMutationInput,
) -> Result<BackendModerationMutationOutput, AppError> {
    let command = "app__backend_moderation_update";
    let diagnostics = state.backend_context.diagnostics.clone();
    let sync = state.backend_context.sync.clone();
    diagnostics.record_command(command, "running", "Moderation mutation started.");

    let result = update_player_moderation(state, input).await;
    match &result {
        Ok(output) => {
            diagnostics.record_command(
                command,
                "ok",
                format!(
                    "target={} type={} enabled={}",
                    output.target_user_id, output.r#type, output.enabled
                ),
            );
            sync.record(
                "moderation",
                "ready",
                format!(
                    "Moderation {} {} for {}.",
                    output.r#type,
                    if output.enabled {
                        "enabled"
                    } else {
                        "disabled"
                    },
                    output.target_user_id
                ),
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("moderation", error.to_string());
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_only_complete_remote_moderation_rows() {
        let rows = normalize_remote_moderation_rows(&json!([
            {
                "id": " mod_1 ",
                "type": " block ",
                "targetUserId": " usr_target ",
                "targetDisplayName": "Target",
                "created": "2026-05-16T00:00:00.000Z"
            },
            {
                "id": "mod_2",
                "type": "mute",
                "targetDisplayName": "Missing target"
            },
            {
                "type": "block",
                "targetUserId": "usr_missing_id"
            }
        ]));

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].r#type, "block");
        assert_eq!(rows[0].target_user_id, "usr_target");
        assert_eq!(rows[0].target_display_name, "Target");
        assert_eq!(rows[0].created, "2026-05-16T00:00:00.000Z");
    }

    #[test]
    fn verifies_refresh_owner_from_remote_rows() {
        let rows = vec![BackendRemoteModerationRow {
            id: "mod_1".into(),
            r#type: "block".into(),
            source_user_id: "usr_current".into(),
            source_display_name: String::new(),
            target_user_id: "usr_target".into(),
            target_display_name: String::new(),
            created: String::new(),
        }];

        assert!(rows_have_verified_owner(&rows, "usr_current"));
        assert!(!rows_have_verified_owner(&rows, "usr_other"));
        assert!(!rows_have_verified_owner(&[], "usr_current"));
    }

    #[test]
    fn local_moderation_update_preserves_other_bit_when_not_supplied() {
        let existing = LocalModerationOutput {
            user_id: "usr_target".into(),
            updated_at: String::new(),
            display_name: String::new(),
            block: true,
            mute: true,
        };

        assert_eq!(
            resolve_local_moderation_state(Some(&existing), "block", false),
            (false, true)
        );
        assert_eq!(
            resolve_local_moderation_state(Some(&existing), "mute", false),
            (true, false)
        );
        assert_eq!(
            resolve_local_moderation_state(Some(&existing), "block", true),
            (true, true)
        );
    }
}
