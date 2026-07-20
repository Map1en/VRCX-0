#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_core::vrchat_api::{self, VrchatApiRequest, VrchatApiResponse, VrchatScope};

use crate::error::AppError;
use crate::state::AppState;

pub async fn execute_vrchat_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
    scope: VrchatScope,
) -> Result<VrchatApiResponse, AppError> {
    vrchat_api::execute_api_command(
        state.web.as_ref(),
        state.db.as_ref(),
        &state.runtime_context.diagnostics,
        &state.runtime_context.sync,
        (command, detail),
        input,
        scope,
    )
    .await
    .map_err(AppError::from)
}
