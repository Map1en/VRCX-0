#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::tools::{
    calendars_get_input, featured_calendars_get_input, following_calendars_get_input,
    group_calendar_get_input, group_calendar_ics_get_input, group_event_follow_input,
    invite_message_edit_input, invite_messages_get_input, user_note_save_input, user_report_input,
};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};

use super::types::{
    VrchatToolsCalendarEventInput, VrchatToolsCalendarGroupInput, VrchatToolsCalendarListInput,
    VrchatToolsFollowGroupEventInput, VrchatToolsInviteMessageEditInput,
    VrchatToolsInviteMessagesInput, VrchatToolsUserNoteSaveInput, VrchatToolsUserReportInput,
};

async fn execute_tools_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    super::super::execute::execute_vrchat_api(state, command, detail, input, VrchatScope::Vrchat)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_calendars_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarListInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_tools_api(
        state,
        "app__vrchat_tools_calendars_get",
        "Getting group calendars.",
        calendars_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.params),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_calendar_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarGroupInput,
) -> Result<VrchatApiResponse, AppError> {
    let (group_id, request) =
        group_calendar_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.group_id)?;
    execute_tools_api(
        state,
        "app__vrchat_tools_group_calendar_get",
        format!("Getting group calendar {group_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_following_calendars_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarListInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_tools_api(
        state,
        "app__vrchat_tools_following_calendars_get",
        "Getting followed group calendars.",
        following_calendars_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.params),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_featured_calendars_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarListInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_tools_api(
        state,
        "app__vrchat_tools_featured_calendars_get",
        "Getting featured group calendars.",
        featured_calendars_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.params),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_event_follow(
    state: State<'_, AppState>,
    input: VrchatToolsFollowGroupEventInput,
) -> Result<VrchatApiResponse, AppError> {
    let (event_id, request) = group_event_follow_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.group_id,
        input.event_id,
        input.is_following,
    )?;
    execute_tools_api(
        state,
        "app__vrchat_tools_group_event_follow",
        format!("Updating follow state for event {event_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_calendar_ics_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarEventInput,
) -> Result<VrchatApiResponse, AppError> {
    let (event_id, request) = group_calendar_ics_get_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.group_id,
        input.event_id,
    )?;
    execute_tools_api(
        state,
        "app__vrchat_tools_group_calendar_ics_get",
        format!("Getting calendar ICS for event {event_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_user_note_save(
    state: State<'_, AppState>,
    input: VrchatToolsUserNoteSaveInput,
) -> Result<VrchatApiResponse, AppError> {
    let (target_user_id, request) = user_note_save_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.target_user_id,
        input.note,
    )?;
    execute_tools_api(
        state,
        "app__vrchat_tools_user_note_save",
        format!("Saving note for user {target_user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_user_report(
    state: State<'_, AppState>,
    input: VrchatToolsUserReportInput,
) -> Result<VrchatApiResponse, AppError> {
    let (user_id, request) = user_report_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.user_id,
        input.content_type,
        input.reason,
        input.type_name,
    )?;
    execute_tools_api(
        state,
        "app__vrchat_tools_user_report",
        format!("Reporting user {user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_invite_messages_get(
    state: State<'_, AppState>,
    input: VrchatToolsInviteMessagesInput,
) -> Result<VrchatApiResponse, AppError> {
    let (current_user_id, request) = invite_messages_get_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.current_user_id,
        input.message_type,
    )?;
    execute_tools_api(
        state,
        "app__vrchat_tools_invite_messages_get",
        format!("Getting invite messages for {current_user_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_invite_message_edit(
    state: State<'_, AppState>,
    input: VrchatToolsInviteMessageEditInput,
) -> Result<VrchatApiResponse, AppError> {
    let (slot, request) = invite_message_edit_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.current_user_id,
        input.message_type,
        input.slot,
        input.message,
    )?;
    execute_tools_api(
        state,
        "app__vrchat_tools_invite_message_edit",
        format!("Editing invite message {slot}."),
        request,
    )
    .await
}
