#![allow(non_snake_case)]

use tauri::State;

use crate::state::AppState;
use vrcx_0_application_core::RuntimeAuthScopeSnapshot;

#[tauri::command]
#[specta::specta]
pub fn app__runtime_auth_scope_get(state: State<'_, AppState>) -> RuntimeAuthScopeSnapshot {
    state.runtime_context.auth_scope.snapshot()
}
