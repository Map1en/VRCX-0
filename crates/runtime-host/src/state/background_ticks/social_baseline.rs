use std::{collections::HashMap, sync::Arc};

use serde_json::json;
use vrcx_0_application::{
    apply_friend_roster_baseline_sync_outcome, build_favorites_baseline,
    build_friend_roster_baseline_deferred, FriendProjection, OverlayFavoriteGroups,
    SocialBaselineDeps, SocialFavoritesBaselineInput, SocialFriendRosterBaselineInput,
};
use vrcx_0_core::{friends::FriendRecord, json::RawJson};

use crate::authenticated_runtime::favorite_group_membership_from_snapshot;

use super::super::{
    background_capability_session, emit_background_error, emit_background_info,
    gui_maintenance_runtime_mode, BACKGROUND_FACTS_REFRESH_JOB,
    BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
};
use super::BackgroundTickContext;

pub(in crate::state) async fn run_background_social_baseline_refresh(
    context: &BackgroundTickContext<'_>,
    favorite_friend_groups_by_key: &mut HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background friend and favorite facts.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background social baseline refresh is waiting for an authenticated session.",
            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
        );
        return;
    };
    let baseline_watermark = match context.realtime_runtime.capture_friend_baseline_watermark() {
        Ok(watermark) => watermark,
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                error = %error,
                "GUI maintenance friend baseline watermark capture failed"
            );
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("social baseline refresh failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
            return;
        }
    };
    let deps = SocialBaselineDeps {
        db: Arc::clone(context.db),
        web: Arc::clone(context.web),
        auth_scope: context.runtime_context.auth_scope.clone(),
        session: context.runtime_context.session.clone(),
    };
    let friend_output = build_friend_roster_baseline_deferred(
        deps.clone(),
        SocialFriendRosterBaselineInput {
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: RawJson::from(session.current_user_snapshot.clone()),
            is_first_load: false,
        },
    )
    .await;
    let friend_count = match friend_output {
        Ok(mut output) => {
            if let Some(snapshot) = output.snapshot.as_ref() {
                let value = snapshot.as_value().clone();
                let raw_friends_value = value
                    .get("friendsById")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                if let Ok(friends_by_id) =
                    serde_json::from_value::<HashMap<String, FriendRecord>>(raw_friends_value)
                {
                    let sync_outcome = context
                        .realtime_runtime
                        .sync_friend_snapshot_with_watermark(
                            session.current_user_id.clone(),
                            session.endpoint.clone(),
                            session.websocket.clone(),
                            baseline_watermark,
                            friends_by_id,
                        );
                    let sync_outcome = match sync_outcome {
                        Ok(outcome) => outcome,
                        Err(error) => {
                            tracing::warn!(
                                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                                error = %error,
                                "GUI maintenance friend baseline realtime sync failed"
                            );
                            context.background_jobs.mark_scheduled(
                                BACKGROUND_FACTS_REFRESH_JOB,
                                "Background friend baseline realtime sync failed.",
                                BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
                            );
                            return;
                        }
                    };
                    let applied = match apply_friend_roster_baseline_sync_outcome(
                        &mut output,
                        sync_outcome,
                    ) {
                        Ok(applied) => applied,
                        Err(error) => {
                            tracing::warn!(
                                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                                error = %error,
                                "GUI maintenance canonical friend baseline encode failed"
                            );
                            context.background_jobs.mark_scheduled(
                                BACKGROUND_FACTS_REFRESH_JOB,
                                "Background canonical friend snapshot encode failed.",
                                BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
                            );
                            return;
                        }
                    };
                    if !applied {
                        context.background_jobs.mark_scheduled(
                            BACKGROUND_FACTS_REFRESH_JOB,
                            "Superseded background friend baseline was ignored.",
                            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
                        );
                        return;
                    }
                    if output.friend_log_changed {
                        context
                            .runtime_context
                            .event_bus
                            .emit_realtime_friend_projection(FriendProjection {
                                friend_log_changed: true,
                                ..Default::default()
                            });
                    }
                    let friends_value = output
                        .snapshot
                        .as_ref()
                        .and_then(|snapshot| snapshot.as_value().get("friendsById"))
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    if let Ok(favorites_output) = build_favorites_baseline(
                        deps,
                        SocialFavoritesBaselineInput {
                            user_id: session.current_user_id.clone(),
                            endpoint: session.endpoint.clone(),
                            current_user_snapshot: RawJson::from(
                                session.current_user_snapshot.clone(),
                            ),
                            friend_roster_by_id: RawJson::from(friends_value),
                        },
                    )
                    .await
                    {
                        context
                            .authenticated_runtime
                            .update_favorites_baseline(favorites_output.clone());
                        if let Some(snapshot) = favorites_output.snapshot {
                            let value = snapshot.into_value();
                            context
                                .vr_overlay_runtime
                                .update_friends_panel_favorite_groups_from_baseline(&value);
                            let groups = favorite_group_membership_from_snapshot(&value);
                            context
                                .runtime_context
                                .overlay_activity
                                .set_favorite_groups(OverlayFavoriteGroups::from_map(
                                    groups.clone(),
                                ));
                            *favorite_friend_groups_by_key = groups;
                        }
                    }
                    output.count
                } else {
                    output.count
                }
            } else {
                output.count
            }
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                error = %error,
                "GUI maintenance social baseline network request failed"
            );
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("social baseline refresh failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
            return;
        }
    };
    let detail = format!("friend and favorite facts refreshed: {friend_count} friends.");
    emit_background_info(
        context.runtime_context,
        context.backend_runtime,
        detail.clone(),
    );
    context
        .background_jobs
        .mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
    context.background_jobs.mark_scheduled(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Next background friend and favorite facts refresh is waiting.",
        BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
    );
}
