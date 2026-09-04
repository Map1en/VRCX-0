#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::favorites::{
    FavoriteCacheSnapshotInput, FavoriteDetailsHydrateInput, FavoriteDetailsHydrateOutput,
    FavoriteImportStartInput, FavoriteImportStatus,
};
use vrcx_0_application::social::{
    AvatarContentTagsBatchInput, BatchMutationResult, GroupBanImportStartInput,
    GroupBanImportStatus, GroupMembershipBatchInput, GroupMembershipBatchResult,
    GroupModerationBatchInput, GroupModerationBatchResult, InstanceInviteBatchInput,
    InstanceInviteBatchResult, NotificationMarkSeenBatchInput, NotificationMarkSeenBatchResult,
    NotificationSyncOutcome,
};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub fn app__favorite_import_start(
    state: State<'_, AppState>,
    input: FavoriteImportStartInput,
) -> Result<FavoriteImportStatus, AppError> {
    Ok(state.runtime_host().favorite_import_start(input)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_import_status(state: State<'_, AppState>) -> FavoriteImportStatus {
    state.runtime_host().favorite_import_status()
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_import_cancel(state: State<'_, AppState>) -> FavoriteImportStatus {
    state.runtime_host().favorite_import_cancel()
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_import_dismiss(state: State<'_, AppState>, runId: String) -> bool {
    state.runtime_host().favorite_import_dismiss(&runId)
}

#[tauri::command]
#[specta::specta]
pub fn app__group_ban_import_start(
    state: State<'_, AppState>,
    input: GroupBanImportStartInput,
) -> Result<GroupBanImportStatus, AppError> {
    Ok(state.runtime_host().group_ban_import_start(input)?)
}

#[tauri::command]
#[specta::specta]
pub fn app__group_ban_import_status(state: State<'_, AppState>) -> GroupBanImportStatus {
    state.runtime_host().group_ban_import_status()
}

#[tauri::command]
#[specta::specta]
pub fn app__group_ban_import_cancel(state: State<'_, AppState>) -> GroupBanImportStatus {
    state.runtime_host().group_ban_import_cancel()
}

#[tauri::command]
#[specta::specta]
pub async fn app__favorite_details_hydrate(
    state: State<'_, AppState>,
    input: FavoriteDetailsHydrateInput,
) -> Result<FavoriteDetailsHydrateOutput, AppError> {
    state.hydrate_favorite_details(input).await
}

#[tauri::command]
#[specta::specta]
pub fn app__favorite_cache_snapshot(
    state: State<'_, AppState>,
    input: FavoriteCacheSnapshotInput,
) -> Result<bool, AppError> {
    Ok(state
        .runtime_host()
        .persist_favorite_cache_snapshot(input)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__avatar_content_tags_batch(
    state: State<'_, AppState>,
    input: AvatarContentTagsBatchInput,
) -> Result<BatchMutationResult, AppError> {
    state.run_avatar_content_tags_batch(input).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__group_membership_batch(
    state: State<'_, AppState>,
    input: GroupMembershipBatchInput,
) -> Result<GroupMembershipBatchResult, AppError> {
    state.run_group_membership_batch(input).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__group_moderation_batch(
    state: State<'_, AppState>,
    input: GroupModerationBatchInput,
) -> Result<GroupModerationBatchResult, AppError> {
    state.run_group_moderation_batch(input).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_mark_seen_batch(
    state: State<'_, AppState>,
    input: NotificationMarkSeenBatchInput,
) -> Result<NotificationMarkSeenBatchResult, AppError> {
    state.mark_notifications_seen_batch(input).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__instance_invite_batch(
    state: State<'_, AppState>,
    input: InstanceInviteBatchInput,
) -> Result<InstanceInviteBatchResult, AppError> {
    state.send_instance_invites_batch(input).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__notification_sync(
    state: State<'_, AppState>,
) -> Result<NotificationSyncOutcome, AppError> {
    state.sync_notifications().await
}
