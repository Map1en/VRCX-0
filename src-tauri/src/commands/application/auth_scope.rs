#![allow(non_snake_case)]

use serde::Deserialize;
use tauri::State;

use crate::state::AppState;
use vrcx_0_application::RuntimeAuthScopeSnapshot;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuthScopeSetInput {
    #[serde(default)]
    user_id: String,
    #[serde(default)]
    endpoint: String,
}

#[tauri::command]
#[specta::specta]
pub fn app__runtime_auth_scope_set(
    state: State<'_, AppState>,
    input: RuntimeAuthScopeSetInput,
) -> RuntimeAuthScopeSnapshot {
    let previous = state.runtime_context.auth_scope.snapshot();
    let snapshot = state
        .runtime_context
        .auth_scope
        .set(input.user_id, input.endpoint);
    state.favorite_import.cancel_if_scope_mismatch();
    state.shared_collection_import.cancel_if_scope_mismatch();
    state.note_export.cancel_if_scope_mismatch();
    if !snapshot.active {
        state.clear_backend_authenticated_session("Runtime auth scope changed.");
    } else if previous.current_user_id != snapshot.current_user_id
        || previous.endpoint != snapshot.endpoint
    {
        state.clear_backend_frontend_session();
    }
    snapshot
}

#[tauri::command]
#[specta::specta]
pub fn app__runtime_auth_scope_get(state: State<'_, AppState>) -> RuntimeAuthScopeSnapshot {
    state.runtime_context.auth_scope.snapshot()
}
