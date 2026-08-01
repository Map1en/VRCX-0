#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    remove_favorites_bulk, transfer_favorites, FavoriteBulkRemoveDeps, FavoriteBulkRemoveInput,
    FavoriteBulkRemoveResult, FavoriteTransferDeps, FavoriteTransferInput, FavoriteTransferResult,
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
    let owner_user_id = state.runtime_context.auth_scope.snapshot().current_user_id;

    let result = transfer_favorites(
        FavoriteTransferDeps {
            db: state.db.as_ref(),
            owner_user_id: &owner_user_id,
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

#[tauri::command]
#[specta::specta]
pub async fn app__favorites_bulk_remove(
    state: State<'_, AppState>,
    input: FavoriteBulkRemoveInput,
) -> Result<FavoriteBulkRemoveResult, AppError> {
    let command = "app__favorites_bulk_remove";
    let target_count = input.items.len();
    let kind = input.kind.clone();
    let diagnostics = state.runtime_context.diagnostics.clone();
    let sync = state.runtime_context.sync.clone();
    diagnostics.record_command(
        command,
        "running",
        format!("Removing {target_count} favorite item(s)."),
    );
    let expected_scope = super::scope::require_active_scope(&state, "Favorite bulk remove")?;
    let result = remove_favorites_bulk(
        &FavoriteBulkRemoveDeps {
            db: state.db.as_ref(),
            web: state.web.as_ref(),
            auth_scope: &state.runtime_context.auth_scope,
            expected_scope,
            remote_mutation_gate: &state.remote_mutations,
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
                    "Removed {} favorite item(s); {} failed.",
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
