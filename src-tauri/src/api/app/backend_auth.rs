#![allow(non_snake_case)]

use serde::Deserialize;
use tauri::State;

use crate::state::AppState;
use vrcx_0_runtime::auth_scope::BackendAuthScopeSnapshot;

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
