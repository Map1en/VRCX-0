#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendToolsCalendarEventInput, BackendToolsCalendarGroupInput, BackendToolsCalendarListInput,
    BackendToolsFollowGroupEventInput, BackendToolsInviteMessageEditInput,
    BackendToolsInviteMessagesInput, BackendToolsUserNoteSaveInput, BackendToolsUserReportInput,
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
    body: Value,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path.into()),
        headers: Some(json_headers()),
        body: Some(body),
        json_body: Some(true),
        ..Default::default()
    }
}

async fn execute_tools_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::execute_vrchat_tools_api(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

#[tauri::command]
pub async fn app__backend_tools_calendars_get(
    state: State<'_, AppState>,
    input: BackendToolsCalendarListInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_tools_api(
        state,
        "app__backend_tools_calendars_get",
        "Getting group calendars.",
        get_input(input.endpoint, "calendar", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_group_calendar_get(
    state: State<'_, AppState>,
    input: BackendToolsCalendarGroupInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendToolsGroupCalendarGet requires groupId.",
    )?;
    execute_tools_api(
        state,
        "app__backend_tools_group_calendar_get",
        format!("Getting group calendar {group_id}."),
        get_input(
            input.endpoint,
            format!("calendar/{}", encode_path_segment(&group_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_following_calendars_get(
    state: State<'_, AppState>,
    input: BackendToolsCalendarListInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_tools_api(
        state,
        "app__backend_tools_following_calendars_get",
        "Getting followed group calendars.",
        get_input(input.endpoint, "calendar/following", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_featured_calendars_get(
    state: State<'_, AppState>,
    input: BackendToolsCalendarListInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_tools_api(
        state,
        "app__backend_tools_featured_calendars_get",
        "Getting featured group calendars.",
        get_input(input.endpoint, "calendar/featured", input.params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_group_event_follow(
    state: State<'_, AppState>,
    input: BackendToolsFollowGroupEventInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendToolsGroupEventFollow requires groupId.",
    )?;
    let event_id = require_text(
        input.event_id,
        "BackendToolsGroupEventFollow requires eventId.",
    )?;
    execute_tools_api(
        state,
        "app__backend_tools_group_event_follow",
        format!("Updating follow state for event {event_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!(
                "calendar/{}/{}/follow",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            json!({ "isFollowing": input.is_following }),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_group_calendar_ics_get(
    state: State<'_, AppState>,
    input: BackendToolsCalendarEventInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendToolsGroupCalendarIcsGet requires groupId.",
    )?;
    let event_id = require_text(
        input.event_id,
        "BackendToolsGroupCalendarIcsGet requires eventId.",
    )?;
    execute_tools_api(
        state,
        "app__backend_tools_group_calendar_ics_get",
        format!("Getting calendar ICS for event {event_id}."),
        get_input(
            input.endpoint,
            format!(
                "calendar/{}/{}.ics",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_user_note_save(
    state: State<'_, AppState>,
    input: BackendToolsUserNoteSaveInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let target_user_id = require_text(
        input.target_user_id,
        "BackendToolsUserNoteSave requires targetUserId.",
    )?;
    execute_tools_api(
        state,
        "app__backend_tools_user_note_save",
        format!("Saving note for user {target_user_id}."),
        api_input(
            input.endpoint,
            "POST",
            "userNotes",
            json!({ "targetUserId": target_user_id, "note": input.note }),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_user_report(
    state: State<'_, AppState>,
    input: BackendToolsUserReportInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendToolsUserReport requires userId.")?;
    let content_type = if input.content_type.trim().is_empty() {
        "user".to_string()
    } else {
        input.content_type
    };
    let type_name = if input.type_name.trim().is_empty() {
        "report".to_string()
    } else {
        input.type_name
    };
    execute_tools_api(
        state,
        "app__backend_tools_user_report",
        format!("Reporting user {user_id}."),
        api_input(
            input.endpoint,
            "POST",
            format!("feedback/{}/user", encode_path_segment(&user_id)),
            json!({
                "contentType": content_type,
                "reason": input.reason,
                "type": type_name,
            }),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_invite_messages_get(
    state: State<'_, AppState>,
    input: BackendToolsInviteMessagesInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let current_user_id = require_text(
        input.current_user_id,
        "BackendToolsInviteMessagesGet requires currentUserId.",
    )?;
    let message_type = require_text(
        input.message_type,
        "BackendToolsInviteMessagesGet requires messageType.",
    )?;
    execute_tools_api(
        state,
        "app__backend_tools_invite_messages_get",
        format!("Getting invite messages for {current_user_id}."),
        get_input(
            input.endpoint,
            format!(
                "message/{}/{}",
                encode_path_segment(&current_user_id),
                encode_path_segment(&message_type)
            ),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_tools_invite_message_edit(
    state: State<'_, AppState>,
    input: BackendToolsInviteMessageEditInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let current_user_id = require_text(
        input.current_user_id,
        "BackendToolsInviteMessageEdit requires currentUserId.",
    )?;
    let message_type = require_text(
        input.message_type,
        "BackendToolsInviteMessageEdit requires messageType.",
    )?;
    let slot = require_text(input.slot, "BackendToolsInviteMessageEdit requires slot.")?;
    execute_tools_api(
        state,
        "app__backend_tools_invite_message_edit",
        format!("Editing invite message {slot}."),
        api_input(
            input.endpoint,
            "PUT",
            format!(
                "message/{}/{}/{}",
                encode_path_segment(&current_user_id),
                encode_path_segment(&message_type),
                encode_path_segment(&slot)
            ),
            json!({ "message": input.message }),
        ),
    )
    .await
}
