#![allow(non_snake_case)]
#![allow(unused_imports)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_store::cache_entities::CacheEntityInput;
use vrcx_0_store::worlds::WorldSummaryOutput;

#[tauri::command]
pub fn app__world_cache_get(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Option<WorldSummaryOutput>, AppError> {
    vrcx_0_store::worlds::app__world_cache_get(state.db.as_ref(), world_id).map_err(AppError::from)
}

#[tauri::command]
pub fn app__world_cache_list(
    state: State<'_, AppState>,
) -> Result<Vec<WorldSummaryOutput>, AppError> {
    vrcx_0_store::worlds::app__world_cache_list(state.db.as_ref()).map_err(AppError::from)
}

#[tauri::command]
pub fn app__world_cache_remove(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<(), AppError> {
    vrcx_0_store::worlds::app__world_cache_remove(state.db.as_ref(), world_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn app__world_cache_upsert(
    state: State<'_, AppState>,
    entry: CacheEntityInput,
) -> Result<i64, AppError> {
    vrcx_0_store::worlds::app__world_cache_upsert(state.db.as_ref(), entry).map_err(AppError::from)
}
