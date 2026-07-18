#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_realtime::{
    apply_friend_roster_baseline_sync_outcome, build_favorites_baseline,
    build_friend_roster_baseline_deferred, SocialBaselineDeps,
};
use vrcx_0_core::friends::FriendRecord;

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

fn mark_friend_roster_output_stale(output: &mut SocialFriendRosterBaselineOutput, detail: &str) {
    output.stale = true;
    output.snapshot = None;
    output.friend_log_changed = false;
    output.detail = detail.into();
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
    let input_endpoint = input.endpoint.clone();
    let input_websocket = input.websocket.clone();
    let baseline_watermark = state
        .realtime_runtime
        .capture_friend_baseline_watermark()
        .map_err(AppError::from)?;
    diagnostics.record_command(command, "running", "Friend roster baseline started.");

    let mut result = build_friend_roster_baseline_deferred(social_baseline_deps(&state), input)
        .await
        .map_err(AppError::from);
    if let Ok(output) = result.as_mut() {
        if !output.stale {
            let friends_by_id = output.snapshot.as_ref().and_then(|snapshot| {
                snapshot
                    .as_value()
                    .get("friendsById")
                    .cloned()
                    .and_then(|friends_value| {
                        serde_json::from_value::<std::collections::HashMap<String, FriendRecord>>(
                            friends_value,
                        )
                        .ok()
                    })
            });
            match friends_by_id {
                Some(friends_by_id) => {
                    match state.realtime_runtime.sync_friend_snapshot_with_watermark(
                        output.user_id.clone(),
                        input_endpoint.clone(),
                        input_websocket.clone(),
                        baseline_watermark,
                        friends_by_id,
                    ) {
                        Ok(sync_outcome) => {
                            if let Err(error) =
                                apply_friend_roster_baseline_sync_outcome(output, sync_outcome)
                            {
                                tracing::warn!(
                                    "Friend roster canonical snapshot encode failed: {error}"
                                );
                                mark_friend_roster_output_stale(
                                    output,
                                    "Friend roster canonical snapshot encode failed.",
                                );
                            }
                        }
                        Err(error) => {
                            tracing::warn!(
                                "Friend roster baseline realtime cache sync failed: {error}"
                            );
                            mark_friend_roster_output_stale(
                                output,
                                "Friend roster realtime sync failed.",
                            );
                        }
                    }
                }
                None => {
                    tracing::warn!("Friend roster baseline friendsById decode failed");
                    mark_friend_roster_output_stale(
                        output,
                        "Friend roster baseline friendsById decode failed.",
                    );
                }
            }
        }
    }
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
