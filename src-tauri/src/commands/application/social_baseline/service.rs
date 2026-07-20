#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_realtime::{
    build_favorites_baseline, build_synced_friend_roster_baseline, SocialBaselineDeps,
};

use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_application_realtime::{
    SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput, SocialFriendRosterBaselineInput,
    SocialFriendRosterBaselineOutput,
};

fn social_baseline_deps(state: &State<'_, AppState>) -> SocialBaselineDeps {
    SocialBaselineDeps {
        db: state.db.clone(),
        web: state.web.clone(),
        auth_scope: state.runtime_context.auth_scope.clone(),
        session: state.runtime_context.session.clone(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__social_favorites_baseline_get(
    state: State<'_, AppState>,
    input: SocialFavoritesBaselineInput,
) -> Result<SocialFavoritesBaselineOutput, AppError> {
    let command = "app__social_favorites_baseline_get";
    let diagnostics = state.runtime_context.diagnostics.clone();
    let sync = state.runtime_context.sync.clone();
    diagnostics.record_command(command, "running", "Favorites baseline started.");

    let result = build_favorites_baseline(social_baseline_deps(&state), input)
        .await
        .map_err(AppError::from);
    match &result {
        Ok(output) => {
            state
                .authenticated_runtime
                .update_favorites_baseline(output.clone());
            let status = if output.stale { "stale" } else { "ok" };
            let sync_status = if output.stale { "stale" } else { "ready" };
            diagnostics.record_command(
                command,
                status,
                format!(
                    "user={} stale={} count={}",
                    output.user_id, output.stale, output.count
                ),
            );
            sync.record(
                "favorites",
                sync_status,
                if output.stale {
                    format!(
                        "Favorites baseline skipped stale request for {}.",
                        output.user_id
                    )
                } else {
                    format!("Favorites baseline loaded for {}.", output.user_id)
                },
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("favorites", error.to_string());
        }
    }

    result
}

#[tauri::command]
#[specta::specta]
pub async fn app__social_friend_roster_baseline_get(
    state: State<'_, AppState>,
    input: SocialFriendRosterBaselineInput,
) -> Result<SocialFriendRosterBaselineOutput, AppError> {
    let command = "app__social_friend_roster_baseline_get";
    let diagnostics = state.runtime_context.diagnostics.clone();
    let sync = state.runtime_context.sync.clone();
    diagnostics.record_command(command, "running", "Friend roster baseline started.");

    let result = build_synced_friend_roster_baseline(
        social_baseline_deps(&state),
        &state.realtime_runtime,
        input,
    )
    .await
    .map(|baseline| baseline.output)
    .map_err(AppError::from);
    match &result {
        Ok(output) => {
            let status = if output.stale { "stale" } else { "ok" };
            let sync_status = if output.stale { "stale" } else { "ready" };
            diagnostics.record_command(
                command,
                status,
                format!(
                    "user={} stale={} count={}",
                    output.user_id, output.stale, output.count
                ),
            );
            sync.record(
                "friends",
                sync_status,
                if output.stale {
                    format!(
                        "Friend roster baseline skipped stale request for {}.",
                        output.user_id
                    )
                } else {
                    format!("Friend roster baseline loaded for {}.", output.user_id)
                },
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("friends", error.to_string());
        }
    }

    result
}
