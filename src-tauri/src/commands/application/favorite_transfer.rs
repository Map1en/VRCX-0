#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    transfer_favorites, FavoriteTransferDeps, FavoriteTransferInput, FavoriteTransferResult,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__favorites_transfer(
    state: State<'_, AppState>,
    input: FavoriteTransferInput,
) -> Result<FavoriteTransferResult, AppError> {
    let kind = input.kind.clone();
    let command = "app__favorites_transfer";
    let diagnostics = state.runtime_context.diagnostics.clone();
    let sync = state.runtime_context.sync.clone();
    diagnostics.record_command(
        command,
        "running",
        format!("Transferring {} favorite item(s).", input.items.len()),
    );

    let result = transfer_favorites(
        FavoriteTransferDeps {
            db: state.db.as_ref(),
            web: state.web.as_ref(),
            diagnostics: &diagnostics,
            sync: &sync,
        },
        input,
    )
    .await;

    match &result {
        Ok(output) => {
            diagnostics.record_command(
                command,
                "ok",
                format!("succeeded={}, failed={}", output.succeeded, output.failed),
            );
            sync.record(
                "favorite",
                "ready",
                format!(
                    "Transferred {} favorite item(s); {} failed.",
                    output.succeeded, output.failed
                ),
                0,
            );
            state.realtime_runtime.notify_favorites_changed(
                &kind,
                output.local_changed,
                output.remote_changed,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("favorite", error.to_string());
        }
    }

    Ok(result?)
}
