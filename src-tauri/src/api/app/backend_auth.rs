#![allow(non_snake_case)]

use serde::Deserialize;
use tauri::State;

use crate::backend::auth_scope::BackendAuthScopeSnapshot;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthScopeSetInput {
    #[serde(default)]
    user_id: String,
    #[serde(default)]
    endpoint: String,
}

#[tauri::command]
pub fn app__backend_auth_scope_set(
    state: State<'_, AppState>,
    input: BackendAuthScopeSetInput,
) -> BackendAuthScopeSnapshot {
    state
        .backend_context
        .auth_scope
        .set(input.user_id, input.endpoint)
}

#[tauri::command]
pub fn app__backend_auth_scope_get(state: State<'_, AppState>) -> BackendAuthScopeSnapshot {
    state.backend_context.auth_scope.snapshot()
}
