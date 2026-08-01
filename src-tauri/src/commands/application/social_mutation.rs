#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::{
    self as social_mutation, SocialFriendMutationInput, SocialFriendMutationOutcome,
    SocialFriendRequestAcceptInput, SocialFriendRequestCancelInput, SocialMutationDeps,
    SocialUnfriendBatchInput, SocialUnfriendBatchResult,
};

use crate::error::AppError;
use crate::state::AppState;

fn deps<'a>(state: &'a State<'_, AppState>) -> SocialMutationDeps<'a> {
    SocialMutationDeps {
        db: &state.db,
        web: &state.web,
        auth_scope: &state.runtime_context.auth_scope,
        realtime: &state.realtime_runtime,
    }
}

fn record_outcome(
    state: &State<'_, AppState>,
    command: &str,
    result: &vrcx_0_application_core::Result<SocialFriendMutationOutcome>,
) {
    let diagnostics = state.runtime_context.diagnostics.clone();
    let sync = state.runtime_context.sync.clone();
    match result {
        Ok(outcome) => {
            diagnostics.record_command(
                command,
                "ok",
                format!(
                    "target={} status={:?}",
                    outcome.target_user_id, outcome.status
                ),
            );
            sync.record(
                "socialMutation",
                "ready",
                format!("{command} completed for {}.", outcome.target_user_id),
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("socialMutation", error.to_string());
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__social_unfriend(
    state: State<'_, AppState>,
    input: SocialFriendMutationInput,
) -> Result<SocialFriendMutationOutcome, AppError> {
    let command = "app__social_unfriend";
    state.runtime_context.diagnostics.record_command(
        command,
        "running",
        format!("Unfriending {}.", input.target_user_id),
    );

    let result = social_mutation::unfriend(deps(&state), input).await;
    record_outcome(&state, command, &result);

    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__social_unfriend_batch(
    state: State<'_, AppState>,
    input: SocialUnfriendBatchInput,
) -> Result<SocialUnfriendBatchResult, AppError> {
    let command = "app__social_unfriend_batch";
    let target_count = input.targets.len();
    state.runtime_context.diagnostics.record_command(
        command,
        "running",
        format!("Unfriending {target_count} user(s)."),
    );

    let result =
        social_mutation::unfriend_batch(deps(&state), &state.remote_mutations, input).await;
    match &result {
        Ok(output) => {
            state.runtime_context.diagnostics.record_command(
                command,
                "ok",
                format!(
                    "succeeded={}, failed={}, localFailed={}",
                    output.succeeded, output.failed, output.local_failed
                ),
            );
            state.runtime_context.sync.record(
                "socialMutation",
                "ready",
                format!(
                    "{command} completed for {} user(s); {} failed.",
                    output.succeeded, output.failed
                ),
                0,
            );
        }
        Err(error) => {
            state
                .runtime_context
                .diagnostics
                .record_command(command, "error", error.to_string());
            state
                .runtime_context
                .sync
                .record_failure("socialMutation", error.to_string());
        }
    }

    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__social_friend_request_send(
    state: State<'_, AppState>,
    input: SocialFriendMutationInput,
) -> Result<SocialFriendMutationOutcome, AppError> {
    let command = "app__social_friend_request_send";
    state.runtime_context.diagnostics.record_command(
        command,
        "running",
        format!("Sending friend request to {}.", input.target_user_id),
    );

    let result = social_mutation::send_friend_request(deps(&state), input).await;
    record_outcome(&state, command, &result);

    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__social_friend_request_cancel(
    state: State<'_, AppState>,
    input: SocialFriendRequestCancelInput,
) -> Result<SocialFriendMutationOutcome, AppError> {
    let command = "app__social_friend_request_cancel";
    state.runtime_context.diagnostics.record_command(
        command,
        "running",
        format!("Canceling friend request to {}.", input.target_user_id),
    );

    let result = social_mutation::cancel_friend_request(deps(&state), input).await;
    record_outcome(&state, command, &result);

    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__social_friend_request_accept(
    state: State<'_, AppState>,
    input: SocialFriendRequestAcceptInput,
) -> Result<SocialFriendMutationOutcome, AppError> {
    let command = "app__social_friend_request_accept";
    state.runtime_context.diagnostics.record_command(
        command,
        "running",
        format!("Accepting friend request from {}.", input.target_user_id),
    );

    let result = social_mutation::accept_friend_request(deps(&state), input).await;
    record_outcome(&state, command, &result);

    Ok(result?)
}
