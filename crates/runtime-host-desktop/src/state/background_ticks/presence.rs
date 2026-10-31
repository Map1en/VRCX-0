use std::collections::{HashMap, HashSet};

use serde_json::Value;
use vrcx_0_application_game::{
    build_background_presence_facts, run_background_presence_automation,
    BackgroundPresenceAutomationState, BackgroundPresenceFactsInput,
};

use super::{
    background_capability_session, background_capability_session_matches, emit_background_error,
    emit_background_info, BACKGROUND_PRESENCE_AUTOMATION_JOB, BACKGROUND_PRESENCE_CADENCE_SECONDS,
};
use super::{BackgroundTickContext, LocalGameFacts};

pub(in crate::state) async fn run_background_presence_tick(
    context: &BackgroundTickContext<'_>,
    presence_state: &mut BackgroundPresenceAutomationState,
    friend_user_ids: &HashSet<String>,
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
    favorite_world_groups_by_key: &HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        "Running background presence automation.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_PRESENCE_AUTOMATION_JOB,
            "Background presence automation is waiting for an authenticated session.",
            BACKGROUND_PRESENCE_CADENCE_SECONDS,
        );
        return;
    };
    let session_identity = session.identity();
    let local_game = LocalGameFacts::from_context(context);
    let game_state_store =
        crate::game_state_store::PersistenceGameStateStore::new(std::sync::Arc::clone(context.db));
    let background_remote = crate::background_remote::DesktopBackgroundRemoteApi::new(
        std::sync::Arc::clone(context.web),
        std::sync::Arc::clone(context.world_cache),
    );
    let facts = match build_background_presence_facts(
        &game_state_store,
        BackgroundPresenceFactsInput {
            session,
            is_game_running: local_game.is_game_running,
            is_steamvr_running: local_game.is_steamvr_running,
            is_game_no_vr: local_game.is_game_no_vr,
            last_game_started_at: local_game.last_game_started_at,
            game_log_snapshot: local_game.game_log_snapshot,
            now_playing: local_game.now_playing,
            friend_user_ids,
            favorite_friend_groups_by_key,
            favorite_world_groups_by_key,
        },
    ) {
        Ok(facts) => facts,
        Err(error) => {
            tracing::warn!(error = %error, "background presence facts build failed");
            emit_background_error(
                context.event_bus,
                context.backend_runtime,
                format!("presence automation facts failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_PRESENCE_AUTOMATION_JOB, error.to_string());
            return;
        }
    };
    let refresh_expectation = context
        .realtime_runtime
        .capture_current_user_refresh_expectation();
    let result = match run_background_presence_automation(
        &game_state_store,
        &background_remote,
        context.auth_scope,
        context.remote_mutations.as_ref(),
        &facts,
        presence_state,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            tracing::warn!(error = %error, "background presence automation failed");
            emit_background_error(
                context.event_bus,
                context.backend_runtime,
                format!("presence automation failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_PRESENCE_AUTOMATION_JOB, error.to_string());
            return;
        }
    };
    if let Some(updated_user) = result.updated_user.clone() {
        let accepted = refresh_expectation.is_some_and(|expectation| {
            context
                .realtime_runtime
                .apply_current_user_refreshed_snapshot_if_sequence(
                    expectation,
                    updated_user.into_value(),
                    result.patch.clone().into_value(),
                )
        });
        if !background_capability_session_matches(context.session_slot, &session_identity) {
            tracing::warn!("ignored stale background presence automation user update");
        } else if !accepted {
            tracing::warn!("ignored background presence automation update rejected by realtime");
        }
    }
    if result.applied {
        tracing::info!(
            patch = %result.patch.as_value(),
            rules = ?result.matched_rule_ids,
            "background presence automation applied"
        );
        emit_background_info(
            context.event_bus,
            context.backend_runtime,
            background_presence_applied_detail(&result.patch, result.matched_rule_ids.len()),
        );
    }
    context.background_jobs.mark_completed(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        format!("Background presence automation tick: {}.", result.reason),
    );
    context.background_jobs.mark_scheduled(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        "Next background presence automation tick is waiting.",
        BACKGROUND_PRESENCE_CADENCE_SECONDS,
    );
}

fn background_presence_applied_detail(patch: &Value, matched_rule_count: usize) -> String {
    let fields = patch
        .as_object()
        .map(|object| {
            let mut fields = object.keys().cloned().collect::<Vec<_>>();
            fields.sort();
            fields.join(", ")
        })
        .filter(|fields| !fields.is_empty())
        .unwrap_or_else(|| "none".into());
    format!("presence automation applied: fields {fields}; matched rules {matched_rule_count}.")
}
