use std::collections::HashMap;

use serde_json::Value;
use vrcx_0_application_game::{
    build_background_presence_facts, run_background_presence_automation,
    BackgroundPresenceAutomationState, BackgroundPresenceFactsInput,
};

use super::BackgroundTickContext;
use super::{
    background_capability_session, background_capability_session_matches, emit_background_error,
    emit_background_info, replace_backend_frontend_session_user_if_session_matches,
    update_backend_frontend_session_user_if_session_matches, BACKGROUND_PRESENCE_AUTOMATION_JOB,
    BACKGROUND_PRESENCE_CADENCE_SECONDS,
};

pub(in crate::state) async fn run_background_presence_tick(
    context: &BackgroundTickContext<'_>,
    presence_state: &mut BackgroundPresenceAutomationState,
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
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
    let host_session = context.runtime_context.session.snapshot();
    let friends_by_id = context
        .realtime_runtime
        .friend_snapshot()
        .map(|snapshot| snapshot.friends_by_id)
        .unwrap_or_default();
    let facts = match build_background_presence_facts(
        context.db.as_ref(),
        BackgroundPresenceFactsInput {
            session: session.clone(),
            is_game_running: host_session.is_game_running,
            is_steamvr_running: host_session.is_steamvr_running,
            is_game_no_vr: context
                .runtime_context
                .config()
                .get_bool("isGameNoVR", false)
                .unwrap_or(false),
            last_game_started_at: host_session.last_game_started_at,
            game_log_snapshot: context.desktop_services.game_log_snapshot(),
            now_playing: context.desktop_services.now_playing(),
            friends_by_id,
            favorite_friend_groups_by_key: favorite_friend_groups_by_key.clone(),
        },
    ) {
        Ok(facts) => facts,
        Err(error) => {
            tracing::warn!(error = %error, "background presence facts build failed");
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("presence automation facts failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_PRESENCE_AUTOMATION_JOB, error.to_string());
            return;
        }
    };
    let result = match run_background_presence_automation(
        context.runtime_context.config(),
        context.web.as_ref(),
        context.db.as_ref(),
        &facts,
        presence_state,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            tracing::warn!(error = %error, "background presence automation failed");
            emit_background_error(
                context.runtime_context,
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
        let overlay_patch = result.patch.clone();
        let accepted = context
            .realtime_runtime
            .sync_current_user_snapshot(
                session.current_user_id.clone(),
                session.endpoint.clone(),
                session.websocket.clone(),
                None,
                updated_user.clone(),
                overlay_patch,
            )
            .unwrap_or(false);
        if !background_capability_session_matches(context.session_slot, &session) {
            tracing::warn!("ignored stale background presence automation user update");
        } else if accepted {
            if let Some(snapshot) = context.realtime_runtime.current_user_snapshot() {
                replace_backend_frontend_session_user_if_session_matches(
                    context.session_slot,
                    &session,
                    &snapshot,
                );
            } else {
                update_backend_frontend_session_user_if_session_matches(
                    context.session_slot,
                    &session,
                    &updated_user,
                );
            }
        } else {
            tracing::warn!("ignored background presence automation update rejected by realtime");
        }
    }
    if result.applied {
        tracing::info!(
            patch = %result.patch,
            rules = ?result.matched_rule_ids,
            "background presence automation applied"
        );
        emit_background_info(
            context.runtime_context,
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
