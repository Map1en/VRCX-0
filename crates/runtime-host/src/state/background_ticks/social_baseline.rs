use std::{collections::HashMap, sync::Arc};

use vrcx_0_application_core::FriendProjection;
use vrcx_0_application_realtime::{
    build_favorites_baseline, build_synced_friend_roster_baseline, SocialBaselineDeps,
    SocialFavoritesBaselineInput, SocialFriendRosterBaselineInput,
};
use vrcx_0_core::json::RawJson;

use crate::authenticated_runtime::favorite_group_membership_from_snapshot;

use super::super::{
    background_capability_session, emit_background_info, emit_background_warning,
    gui_maintenance_runtime_mode, BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
    BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
};
use super::BackgroundTickContext;

pub(in crate::state) async fn run_background_social_baseline_refresh(
    context: &BackgroundTickContext<'_>,
    favorite_friend_groups_by_key: &mut HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
        "Refreshing background friend and favorite facts.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
            "Background social baseline refresh is waiting for an authenticated session.",
            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
        );
        return;
    };
    let deps = SocialBaselineDeps {
        db: Arc::clone(context.db),
        web: Arc::clone(context.web),
        auth_scope: context.runtime_context.auth_scope.clone(),
        session: context.runtime_context.session.clone(),
    };
    let friend_output = build_synced_friend_roster_baseline(
        deps.clone(),
        context.realtime_runtime,
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
        Ok(baseline) => {
            let output = baseline.output;
            if baseline.friends_by_id.is_none() {
                context.background_jobs.mark_scheduled(
                    BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
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
            if let Some(friends_value) = output
                .snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.as_value().get("friendsById"))
                .cloned()
            {
                if let Ok(favorites_output) = build_favorites_baseline(
                    deps,
                    SocialFavoritesBaselineInput {
                        user_id: session.current_user_id.clone(),
                        endpoint: session.endpoint.clone(),
                        current_user_snapshot: RawJson::from(session.current_user_snapshot.clone()),
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
                        let groups = favorite_group_membership_from_snapshot(&value);
                        context
                            .authenticated_runtime
                            .apply_favorites_snapshot(&value);
                        *favorite_friend_groups_by_key = groups;
                    }
                }
            }
            output.count
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                error = %error,
                "GUI maintenance friend baseline refresh failed"
            );
            emit_background_warning(
                context.runtime_context,
                context.backend_runtime,
                format!("social baseline refresh failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB, error.to_string());
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
        .mark_completed(BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB, detail);
    context.background_jobs.mark_scheduled(
        BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
        "Next background friend and favorite facts refresh is waiting.",
        BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
    );
}
