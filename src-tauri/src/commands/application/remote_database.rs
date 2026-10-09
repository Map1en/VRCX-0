#![allow(non_snake_case)]

use serde::Serialize;
use specta::Type;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Clone, Copy, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RemoteDatabaseConnectionState {
    Connected,
    Disconnected,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDatabaseConnectionSnapshot {
    pub is_remote: bool,
    pub state: Option<RemoteDatabaseConnectionState>,
    pub error: Option<String>,
}

fn snapshot(state: &AppState, error: Option<String>) -> RemoteDatabaseConnectionSnapshot {
    let status = state.runtime_host().database().remote_connection_status();
    RemoteDatabaseConnectionSnapshot {
        is_remote: status.is_some(),
        state: status.map(|status| match status {
            vrcx_0_persistence::RemoteConnectionStatus::Connected => {
                RemoteDatabaseConnectionState::Connected
            }
            vrcx_0_persistence::RemoteConnectionStatus::Disconnected => {
                RemoteDatabaseConnectionState::Disconnected
            }
        }),
        error,
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__remote_database_connection_status_get(
    state: State<'_, AppState>,
) -> RemoteDatabaseConnectionSnapshot {
    snapshot(&state, None)
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__remote_database_connection_check(
    state: State<'_, AppState>,
) -> Result<RemoteDatabaseConnectionSnapshot, AppError> {
    let database = std::sync::Arc::clone(state.runtime_host().database());
    let result = tauri::async_runtime::spawn_blocking(move || database.check_remote_connection())
        .await
        .map_err(|error| AppError::Custom(error.to_string()))?;
    match result {
        Ok(()) => Ok(snapshot(&state, None)),
        Err(_) => Ok(snapshot(
            &state,
            Some("Remote database is unavailable. Check the server and network connection.".into()),
        )),
    }
}
