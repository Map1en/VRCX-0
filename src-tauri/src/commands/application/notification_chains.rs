#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::social::{
    NotificationActionOutcome, NotificationBoopDismissInput, NotificationBoopReplyInput,
    NotificationHideExpireInput, NotificationInstanceInviteInput, NotificationInviteResponseInput,
    NotificationRequestInviteAcceptInput, NotificationRespondInput,
};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn app__notification_hide_and_expire(
    state: State<'_, AppState>,
    input: NotificationHideExpireInput,
) -> Result<NotificationActionOutcome, AppError> {
    let outcome = state
        .runtime_host()
        .social()
        .hide_and_expire_notification(input)
        .await?;
    state.runtime_host().refresh_tray_notification();
    Ok(outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_request_invite_accept(
    state: State<'_, AppState>,
    input: NotificationRequestInviteAcceptInput,
) -> Result<NotificationActionOutcome, AppError> {
    let outcome = state
        .runtime_host()
        .social()
        .accept_request_invite_notification(input)
        .await?;
    state.runtime_host().refresh_tray_notification();
    Ok(outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_instance_invite_send(
    state: State<'_, AppState>,
    input: NotificationInstanceInviteInput,
) -> Result<NotificationActionOutcome, AppError> {
    let outcome = state
        .runtime_host()
        .social()
        .send_instance_invite_notification(input)
        .await?;
    state.runtime_host().refresh_tray_notification();
    Ok(outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_invite_response_send(
    state: State<'_, AppState>,
    input: NotificationInviteResponseInput,
) -> Result<NotificationActionOutcome, AppError> {
    let outcome = state
        .runtime_host()
        .social()
        .send_invite_response_notification(input)
        .await?;
    state.runtime_host().refresh_tray_notification();
    Ok(outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_boop_dismiss(
    state: State<'_, AppState>,
    input: NotificationBoopDismissInput,
) -> Result<NotificationActionOutcome, AppError> {
    let outcome = state
        .runtime_host()
        .social()
        .dismiss_boop_notifications(input)
        .await?;
    state.runtime_host().refresh_tray_notification();
    Ok(outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_boop_reply(
    state: State<'_, AppState>,
    input: NotificationBoopReplyInput,
) -> Result<NotificationActionOutcome, AppError> {
    let outcome = state
        .runtime_host()
        .social()
        .send_boop_reply_notification(input)
        .await?;
    state.runtime_host().refresh_tray_notification();
    Ok(outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_respond_and_expire(
    state: State<'_, AppState>,
    input: NotificationRespondInput,
) -> Result<NotificationActionOutcome, AppError> {
    let outcome = state
        .runtime_host()
        .social()
        .respond_and_expire_notification(input)
        .await?;
    state.runtime_host().refresh_tray_notification();
    Ok(outcome)
}
