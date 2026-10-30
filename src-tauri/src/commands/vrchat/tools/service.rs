#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;

use super::types::{
    VrchatToolsCalendarEventInput, VrchatToolsCalendarGroupInput, VrchatToolsCalendarListInput,
    VrchatToolsFollowGroupEventInput, VrchatToolsGroupEventCreateInput,
    VrchatToolsGroupEventUpdateInput, VrchatToolsInviteMessageEditInput,
    VrchatToolsInviteMessagesInput, VrchatToolsModerationReportsInput,
    VrchatToolsUserNoteSaveInput, VrchatToolsUserReportInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_calendar_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarGroupInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .group_calendar(input.group_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_following_calendars_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarListInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .following_calendars(input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_event_follow(
    state: State<'_, AppState>,
    input: VrchatToolsFollowGroupEventInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .follow_group_event(input.group_id, input.event_id, input.is_following)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_event_create(
    state: State<'_, AppState>,
    input: VrchatToolsGroupEventCreateInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .create_group_event(input.group_id, input.event)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_event_update(
    state: State<'_, AppState>,
    input: VrchatToolsGroupEventUpdateInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .update_group_event(input.group_id, input.event_id, input.event)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_event_delete(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarEventInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .delete_group_event(input.group_id, input.event_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_calendar_event_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarEventInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .group_calendar_event(input.group_id, input.event_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_group_calendar_ics_get(
    state: State<'_, AppState>,
    input: VrchatToolsCalendarEventInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .group_calendar_ics(input.group_id, input.event_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_user_note_save(
    state: State<'_, AppState>,
    input: VrchatToolsUserNoteSaveInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .save_user_note(input.target_user_id, input.note)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_user_report(
    state: State<'_, AppState>,
    input: VrchatToolsUserReportInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .report_user(
            input.user_id,
            input.category,
            input.reason,
            input.description,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_moderation_reports_get(
    state: State<'_, AppState>,
    input: VrchatToolsModerationReportsInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .moderation_reports(
            input.current_user_id,
            input.offset,
            input.closed_only,
            input.report_type,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_invite_messages_get(
    state: State<'_, AppState>,
    input: VrchatToolsInviteMessagesInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .invite_messages(input.current_user_id, input.message_type)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_tools_invite_message_edit(
    state: State<'_, AppState>,
    input: VrchatToolsInviteMessageEditInput,
) -> Result<VrchatApiResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .edit_invite_message(
            input.current_user_id,
            input.message_type,
            input.slot,
            input.message,
        )
        .await
        .map_err(AppError::from)
}
