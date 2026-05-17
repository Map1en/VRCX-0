#![allow(non_snake_case)]

use std::collections::HashMap;

use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub mod types {
    pub use vrcx_0_store::local_data::types::*;
}

use types::*;

#[tauri::command]
pub fn app__config_set_values(
    state: State<'_, AppState>,
    entries: Vec<ConfigWriteEntry>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__config_set_values(state.db.as_ref(), entries)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__config_list_values(
    state: State<'_, AppState>,
) -> Result<Vec<ConfigReadEntry>, AppError> {
    vrcx_0_store::local_data::app__config_list_values(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__config_remove_value(state: State<'_, AppState>, key: String) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__config_remove_value(state.db.as_ref(), key)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__user_tables_ensure(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<UserTableContextOutput, AppError> {
    vrcx_0_store::local_data::app__user_tables_ensure(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__database_maintenance_run(
    state: State<'_, AppState>,
    task: String,
) -> Result<(), AppError> {
    let task = task.trim().to_string();
    let job_name = format!("databaseMaintenance.{task}");
    state.backend_context.diagnostics.record_command(
        "app__database_maintenance_run",
        "running",
        format!("task={task}"),
    );
    state.backend_context.background_jobs.register_job(
        &job_name,
        "rust-command",
        None,
        "running",
        format!("Running maintenance task {task}."),
    );
    let result =
        vrcx_0_store::local_data::app__database_maintenance_run(state.db.as_ref(), task.clone())
            .map_err(AppError::from);
    match &result {
        Ok(()) => {
            state
                .backend_context
                .background_jobs
                .mark_completed(&job_name, format!("Maintenance task {task} finished."));
            state.backend_context.diagnostics.record_command(
                "app__database_maintenance_run",
                "ok",
                format!("task={task}"),
            );
        }
        Err(error) => {
            state
                .backend_context
                .background_jobs
                .mark_failed(&job_name, error.to_string());
            state.backend_context.diagnostics.record_command(
                "app__database_maintenance_run",
                "error",
                format!("task={task}: {error}"),
            );
        }
    }
    result
}

#[tauri::command]
pub fn app__database_maintenance_table_sizes_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<MaintenanceTableSizesOutput, AppError> {
    vrcx_0_store::local_data::app__database_maintenance_table_sizes_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__database_maintenance_max_friend_log_number_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__database_maintenance_max_friend_log_number_get(
        state.db.as_ref(),
        user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__database_maintenance_broken_leave_entries_get(
    state: State<'_, AppState>,
) -> Result<Vec<Value>, AppError> {
    vrcx_0_store::local_data::app__database_maintenance_broken_leave_entries_get(state.db.as_ref())
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__database_maintenance_broken_game_log_display_names_get(
    state: State<'_, AppState>,
) -> Result<Vec<BrokenGameLogDisplayNameOutput>, AppError> {
    vrcx_0_store::local_data::app__database_maintenance_broken_game_log_display_names_get(
        state.db.as_ref(),
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_cache_upsert(
    state: State<'_, AppState>,
    entry: CacheEntityInput,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__avatar_cache_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_cache_get(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Option<AvatarCacheOutput>, AppError> {
    vrcx_0_store::local_data::app__avatar_cache_get(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_cache_list(
    state: State<'_, AppState>,
) -> Result<Vec<AvatarCacheOutput>, AppError> {
    vrcx_0_store::local_data::app__avatar_cache_list(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_cache_remove(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__avatar_cache_remove(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_history_add(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__avatar_history_add(state.db.as_ref(), user_id, avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_time_spent_add(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
    time_spent: i64,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__avatar_time_spent_add(
        state.db.as_ref(),
        user_id,
        avatar_id,
        time_spent,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_history_list(
    state: State<'_, AppState>,
    user_id: String,
    limit: i64,
) -> Result<Vec<AvatarCacheOutput>, AppError> {
    vrcx_0_store::local_data::app__avatar_history_list(state.db.as_ref(), user_id, limit)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_time_spent_get(
    state: State<'_, AppState>,
    user_id: String,
    avatar_id: String,
) -> Result<AvatarTimeSpentOutput, AppError> {
    vrcx_0_store::local_data::app__avatar_time_spent_get(state.db.as_ref(), user_id, avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_time_spent_list(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<AvatarTimeSpentOutput>, AppError> {
    vrcx_0_store::local_data::app__avatar_time_spent_list(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_history_clear(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__avatar_history_clear(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tag_add(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__avatar_tag_add(state.db.as_ref(), avatar_id, tag, color)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_get(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Vec<AvatarTagOutput>, AppError> {
    vrcx_0_store::local_data::app__avatar_tags_get(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_list(state: State<'_, AppState>) -> Result<Vec<AvatarTagOutput>, AppError> {
    vrcx_0_store::local_data::app__avatar_tags_list(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_distinct(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    vrcx_0_store::local_data::app__avatar_tags_distinct(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tag_update_color(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__avatar_tag_update_color(state.db.as_ref(), avatar_id, tag, color)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tag_remove(
    state: State<'_, AppState>,
    avatar_id: String,
    tag: Value,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__avatar_tag_remove(state.db.as_ref(), avatar_id, tag)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_remove_all(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__avatar_tags_remove_all(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_replace(
    state: State<'_, AppState>,
    avatar_id: String,
    entries: Vec<AvatarTagInput>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__avatar_tags_replace(state.db.as_ref(), avatar_id, entries)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__avatar_tags_patch(
    state: State<'_, AppState>,
    avatar_id: String,
    patch: AvatarTagsPatchInput,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__avatar_tags_patch(state.db.as_ref(), avatar_id, patch)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__feed_add_entry(
    state: State<'_, AppState>,
    user_id: String,
    entry: Value,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__feed_add_entry(state.db.as_ref(), user_id, entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__feed_avatar_purge(
    state: State<'_, AppState>,
    user_id: String,
    cutoff_date: Option<String>,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__feed_avatar_purge(state.db.as_ref(), user_id, cutoff_date)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__feed_rows_query(
    state: State<'_, AppState>,
    query: FeedRowsQueryInput,
) -> Result<Vec<FeedRowOutput>, AppError> {
    vrcx_0_store::local_data::app__feed_rows_query(state.db.as_ref(), query).map_err(AppError::from)
}

#[tauri::command]
pub fn app__feed_read_model_query(
    state: State<'_, AppState>,
    query: FeedReadModelQueryInput,
) -> Result<FeedReadModelOutput, AppError> {
    vrcx_0_store::local_data::app__feed_read_model_query(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__feed_live_rows_merge(query: FeedLiveRowsMergeInput) -> FeedReadModelOutput {
    vrcx_0_store::local_data::app__feed_live_rows_merge(query)
}

#[tauri::command]
pub fn app__game_log_entries_add(
    state: State<'_, AppState>,
    kind: String,
    entries: Vec<Value>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__game_log_entries_add(state.db.as_ref(), kind, entries)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__game_log_instance_delete_by_location(
    state: State<'_, AppState>,
    location: String,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__game_log_instance_delete_by_location(state.db.as_ref(), location)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__game_log_instance_delete(
    state: State<'_, AppState>,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__game_log_instance_delete(state.db.as_ref(), location, event_ids)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__game_log_entry_delete(
    state: State<'_, AppState>,
    kind: String,
    entry: Value,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__game_log_entry_delete(state.db.as_ref(), kind, entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__game_log_query(
    state: State<'_, AppState>,
    query: GameLogQueryInput,
) -> Result<Value, AppError> {
    vrcx_0_store::local_data::app__game_log_query(state.db.as_ref(), query).map_err(AppError::from)
}

#[tauri::command]
pub fn app__player_list_location_get(
    state: State<'_, AppState>,
    location: String,
) -> Result<Option<PlayerLocationOutput>, AppError> {
    vrcx_0_store::local_data::app__player_list_location_get(state.db.as_ref(), location)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__player_list_latest_location_get(
    state: State<'_, AppState>,
) -> Result<Option<PlayerLocationOutput>, AppError> {
    vrcx_0_store::local_data::app__player_list_latest_location_get(state.db.as_ref())
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__player_list_join_leave_rows(
    state: State<'_, AppState>,
    location: String,
    started_at: String,
) -> Result<Vec<PlayerJoinLeaveOutput>, AppError> {
    vrcx_0_store::local_data::app__player_list_join_leave_rows(
        state.db.as_ref(),
        location,
        started_at,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__instance_activity_dates_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<String>, AppError> {
    vrcx_0_store::local_data::app__instance_activity_dates_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__instance_activity_rows_get(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<InstanceActivityRowOutput>, AppError> {
    vrcx_0_store::local_data::app__instance_activity_rows_get(
        state.db.as_ref(),
        start_date,
        end_date,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__world_summaries_get(
    state: State<'_, AppState>,
    world_ids: Vec<String>,
) -> Result<HashMap<String, WorldSummaryOutput>, AppError> {
    vrcx_0_store::local_data::app__world_summaries_get(state.db.as_ref(), world_ids)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_self_source_slice(
    state: State<'_, AppState>,
    query: ActivitySelfSourceSliceInput,
) -> Result<Vec<ActivitySourceLocationOutput>, AppError> {
    vrcx_0_store::local_data::app__activity_self_source_slice(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_self_source_after(
    state: State<'_, AppState>,
    query: ActivitySelfSourceAfterInput,
) -> Result<Vec<ActivitySourceLocationOutput>, AppError> {
    vrcx_0_store::local_data::app__activity_self_source_after(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_friend_presence_slice(
    state: State<'_, AppState>,
    query: ActivityFriendPresenceSliceInput,
) -> Result<Vec<ActivityPresenceOutput>, AppError> {
    vrcx_0_store::local_data::app__activity_friend_presence_slice(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_friend_presence_after(
    state: State<'_, AppState>,
    query: ActivityFriendPresenceAfterInput,
) -> Result<Vec<ActivityPresenceOutput>, AppError> {
    vrcx_0_store::local_data::app__activity_friend_presence_after(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_self_sessions_refresh(
    state: State<'_, AppState>,
    input: ActivitySelfSessionsRefreshInput,
) -> Result<ActivitySelfSessionsRefreshOutput, AppError> {
    vrcx_0_store::local_data::app__activity_self_sessions_refresh(state.db.as_ref(), input)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sync_state_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Option<ActivitySyncStateOutput>, AppError> {
    vrcx_0_store::local_data::app__activity_sync_state_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sessions_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<ActivitySessionOutput>, AppError> {
    vrcx_0_store::local_data::app__activity_sessions_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_bucket_cache_get(
    state: State<'_, AppState>,
    query: ActivityBucketCacheQueryInput,
) -> Result<Option<ActivityBucketCacheOutput>, AppError> {
    vrcx_0_store::local_data::app__activity_bucket_cache_get(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sync_state_upsert(
    state: State<'_, AppState>,
    entry: ActivitySyncStateInput,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__activity_sync_state_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sessions_replace(
    state: State<'_, AppState>,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__activity_sessions_replace(state.db.as_ref(), user_id, sessions)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_sessions_append(
    state: State<'_, AppState>,
    user_id: String,
    sessions: Vec<ActivitySessionInput>,
    replace_from_start_at: Option<i64>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__activity_sessions_append(
        state.db.as_ref(),
        user_id,
        sessions,
        replace_from_start_at,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__activity_bucket_cache_upsert(
    state: State<'_, AppState>,
    entry: ActivityBucketCacheInput,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__activity_bucket_cache_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__mutual_graph_tables_ensure(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<UserTableContextOutput, AppError> {
    vrcx_0_store::local_data::app__mutual_graph_tables_ensure(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__mutual_graph_snapshot_get(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<MutualGraphSnapshotOutput, AppError> {
    vrcx_0_store::local_data::app__mutual_graph_snapshot_get(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__mutual_graph_snapshot_save(
    state: State<'_, AppState>,
    user_id: String,
    entries: Vec<MutualGraphSnapshotEntryInput>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__mutual_graph_snapshot_save(state.db.as_ref(), user_id, entries)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__mutual_graph_friend_update(
    state: State<'_, AppState>,
    user_id: String,
    friend_id: String,
    mutual_ids: Vec<String>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__mutual_graph_friend_update(
        state.db.as_ref(),
        user_id,
        friend_id,
        mutual_ids,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__mutual_graph_meta_upsert(
    state: State<'_, AppState>,
    user_id: String,
    entry: MutualGraphMetaInput,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__mutual_graph_meta_upsert(state.db.as_ref(), user_id, entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__mutual_graph_meta_bulk_upsert(
    state: State<'_, AppState>,
    user_id: String,
    entries: Vec<MutualGraphMetaInput>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__mutual_graph_meta_bulk_upsert(
        state.db.as_ref(),
        user_id,
        entries,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__world_cache_upsert(
    state: State<'_, AppState>,
    entry: CacheEntityInput,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__world_cache_upsert(state.db.as_ref(), entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__world_cache_remove(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__world_cache_remove(state.db.as_ref(), world_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__world_cache_list(
    state: State<'_, AppState>,
) -> Result<Vec<WorldSummaryOutput>, AppError> {
    vrcx_0_store::local_data::app__world_cache_list(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__world_cache_get(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Option<WorldSummaryOutput>, AppError> {
    vrcx_0_store::local_data::app__world_cache_get(state.db.as_ref(), world_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_list(
    state: State<'_, AppState>,
    kind: String,
) -> Result<Vec<Value>, AppError> {
    vrcx_0_store::local_data::app__favorite_list(state.db.as_ref(), kind).map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_add(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__favorite_add(state.db.as_ref(), kind, entity_id, group_name)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_remove(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__favorite_remove(state.db.as_ref(), kind, entity_id, group_name)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_group_rename(
    state: State<'_, AppState>,
    kind: String,
    group_name: String,
    new_group_name: String,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__favorite_group_rename(
        state.db.as_ref(),
        kind,
        group_name,
        new_group_name,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__favorite_group_delete(
    state: State<'_, AppState>,
    kind: String,
    group_name: String,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__favorite_group_delete(state.db.as_ref(), kind, group_name)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__memo_get_user(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Option<UserMemoOutput>, AppError> {
    vrcx_0_store::local_data::app__memo_get_user(state.db.as_ref(), user_id).map_err(AppError::from)
}

#[tauri::command]
pub fn app__memo_list_users(state: State<'_, AppState>) -> Result<Vec<UserMemoOutput>, AppError> {
    vrcx_0_store::local_data::app__memo_list_users(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__memo_list_user_notes(
    state: State<'_, AppState>,
    owner_user_id: String,
) -> Result<Vec<UserNoteOutput>, AppError> {
    vrcx_0_store::local_data::app__memo_list_user_notes(state.db.as_ref(), owner_user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__memo_get_world(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Option<WorldMemoOutput>, AppError> {
    vrcx_0_store::local_data::app__memo_get_world(state.db.as_ref(), world_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__memo_get_avatar(
    state: State<'_, AppState>,
    avatar_id: String,
) -> Result<Option<AvatarMemoOutput>, AppError> {
    vrcx_0_store::local_data::app__memo_get_avatar(state.db.as_ref(), avatar_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__memo_save_user(
    state: State<'_, AppState>,
    user_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    vrcx_0_store::local_data::app__memo_save_user(state.db.as_ref(), user_id, memo)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__memo_save_world(
    state: State<'_, AppState>,
    world_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    vrcx_0_store::local_data::app__memo_save_world(state.db.as_ref(), world_id, memo)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__memo_save_avatar(
    state: State<'_, AppState>,
    avatar_id: String,
    memo: String,
) -> Result<MemoSaveResult, AppError> {
    vrcx_0_store::local_data::app__memo_save_avatar(state.db.as_ref(), avatar_id, memo)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__friend_log_current_list(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<FriendLogCurrentOutput>, AppError> {
    vrcx_0_store::local_data::app__friend_log_current_list(state.db.as_ref(), user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__friend_log_history_query(
    state: State<'_, AppState>,
    query: FriendLogHistoryQueryInput,
) -> Result<Vec<FriendLogHistoryOutput>, AppError> {
    vrcx_0_store::local_data::app__friend_log_history_query(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__friend_log_replace_current(
    state: State<'_, AppState>,
    user_id: String,
    entries: Vec<FriendLogCurrentEntryInput>,
    options: FriendLogReplaceOptionsInput,
) -> Result<FriendLogMutationResult, AppError> {
    vrcx_0_store::local_data::app__friend_log_replace_current(
        state.db.as_ref(),
        user_id,
        entries,
        options,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__friend_log_delete_current_array(
    state: State<'_, AppState>,
    user_id: String,
    target_user_ids: Vec<String>,
    options: FriendLogDeleteOptionsInput,
) -> Result<FriendLogMutationResult, AppError> {
    vrcx_0_store::local_data::app__friend_log_delete_current_array(
        state.db.as_ref(),
        user_id,
        target_user_ids,
        options,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__friend_log_upsert_current(
    state: State<'_, AppState>,
    user_id: String,
    entry: FriendLogCurrentEntryInput,
    options: FriendLogUpsertOptionsInput,
) -> Result<FriendLogMutationResult, AppError> {
    vrcx_0_store::local_data::app__friend_log_upsert_current(
        state.db.as_ref(),
        user_id,
        entry,
        options,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__friend_log_delete_current(
    state: State<'_, AppState>,
    user_id: String,
    target_user_id: String,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__friend_log_delete_current(
        state.db.as_ref(),
        user_id,
        target_user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__friend_log_history_add(
    state: State<'_, AppState>,
    user_id: String,
    entries: Vec<FriendLogHistoryEntryInput>,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__friend_log_history_add(state.db.as_ref(), user_id, entries)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__friend_log_history_delete(
    state: State<'_, AppState>,
    user_id: String,
    entry: FriendLogHistoryEntryInput,
) -> Result<i64, AppError> {
    vrcx_0_store::local_data::app__friend_log_history_delete(state.db.as_ref(), user_id, entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_rows_query(
    state: State<'_, AppState>,
    query: NotificationRowsQueryInput,
) -> Result<NotificationRowsOutput, AppError> {
    vrcx_0_store::local_data::app__notification_rows_query(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_list_query(
    state: State<'_, AppState>,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, AppError> {
    vrcx_0_store::local_data::app__notification_list_query(state.db.as_ref(), query)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_add_v1(
    state: State<'_, AppState>,
    user_id: String,
    notification: Value,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__notification_add_v1(state.db.as_ref(), user_id, notification)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_add_v2(
    state: State<'_, AppState>,
    user_id: String,
    notification: Value,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__notification_add_v2(state.db.as_ref(), user_id, notification)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_v2_expire(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__notification_v2_expire(state.db.as_ref(), user_id, id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_v2_mark_seen(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__notification_v2_mark_seen(state.db.as_ref(), user_id, id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_update_expired(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
    expired: bool,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__notification_update_expired(
        state.db.as_ref(),
        user_id,
        id,
        expired,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_delete(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__notification_delete(state.db.as_ref(), user_id, id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_expire(
    state: State<'_, AppState>,
    user_id: String,
    id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__notification_expire(state.db.as_ref(), user_id, id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__notification_mark_seen_local_bulk(
    state: State<'_, AppState>,
    user_id: String,
    ids: Vec<String>,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__notification_mark_seen_local_bulk(
        state.db.as_ref(),
        user_id,
        ids,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_list(
    state: State<'_, AppState>,
    owner_user_id: String,
) -> Result<Vec<LocalModerationOutput>, AppError> {
    vrcx_0_store::local_data::app__local_moderation_list(state.db.as_ref(), owner_user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_get(
    state: State<'_, AppState>,
    owner_user_id: String,
    user_id: String,
) -> Result<Option<LocalModerationOutput>, AppError> {
    vrcx_0_store::local_data::app__local_moderation_get(state.db.as_ref(), owner_user_id, user_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_set(
    state: State<'_, AppState>,
    owner_user_id: String,
    entry: LocalModerationInput,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__local_moderation_set(state.db.as_ref(), owner_user_id, entry)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_delete(
    state: State<'_, AppState>,
    owner_user_id: String,
    user_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::local_data::app__local_moderation_delete(
        state.db.as_ref(),
        owner_user_id,
        user_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn app__local_moderation_sync_snapshot(
    state: State<'_, AppState>,
    owner_user_id: String,
    rows: Vec<RemoteModerationInput>,
) -> Result<Vec<LocalModerationOutput>, AppError> {
    vrcx_0_store::local_data::app__local_moderation_sync_snapshot(
        state.db.as_ref(),
        owner_user_id,
        rows,
    )
    .map_err(AppError::from)
}
