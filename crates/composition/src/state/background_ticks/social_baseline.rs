use std::collections::HashMap;
use std::sync::Arc;

use vrcx_0_application::social::refresh_social_baseline;
use vrcx_0_application_realtime::SocialBaselineDeps;

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
    let deps = SocialBaselineDeps::new(
        Arc::clone(context.realtime_store),
        Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeRemoteRequests),
        Arc::clone(context.web),
        context.runtime_context.auth_scope.clone(),
    );
    let core = match refresh_social_baseline(
        deps,
        context.realtime_runtime,
        context.authenticated_runtime,
        &session,
    )
    .await
    {
        Ok(core) => core,
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
    if core.stale {
        context.background_jobs.mark_scheduled(
            BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
            "Superseded background friend baseline was ignored.",
            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
        );
        return;
    }
    if let Ok(Some(favorites)) = core.favorites {
        *favorite_friend_groups_by_key = favorites.groups;
    }
    let detail = format!(
        "friend and favorite facts refreshed: {} friends.",
        core.friend_count
    );
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
