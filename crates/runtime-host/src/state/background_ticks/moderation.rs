use std::sync::{Arc, Mutex};

use vrcx_0_application::{
    refresh_player_moderations, BackendRuntime, ModerationSyncDeps, ModerationSyncRefreshInput,
    RuntimeBackgroundJobs, WebClient,
};
use vrcx_0_persistence::DatabaseService;

use crate::RuntimeHostContext;

use super::super::{
    background_capability_session, emit_background_error, emit_background_info,
    gui_maintenance_runtime_mode, BackendRuntimeFrontendSessionSnapshot,
    BACKGROUND_MODERATION_CADENCE_SECONDS, BACKGROUND_MODERATION_REFRESH_JOB,
};

pub(in crate::state) async fn run_background_moderation_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
) {
    background_jobs.mark_running(
        BACKGROUND_MODERATION_REFRESH_JOB,
        "Refreshing background moderation facts.",
    );
    let Some(session) = background_capability_session(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_MODERATION_REFRESH_JOB,
            "Background moderation refresh is waiting for an authenticated session.",
            BACKGROUND_MODERATION_CADENCE_SECONDS,
        );
        return;
    };
    let deps = ModerationSyncDeps {
        db: db.as_ref(),
        web: web.as_ref(),
        session: &runtime_context.session,
        auth_scope: &runtime_context.auth_scope,
    };
    match refresh_player_moderations(
        deps,
        ModerationSyncRefreshInput {
            user_id: session.current_user_id,
            endpoint: session.endpoint,
        },
    )
    .await
    {
        Ok(output) => {
            let detail = format!(
                "moderation facts refreshed: {} local rows.",
                output.local_count
            );
            emit_background_info(runtime_context, backend_runtime, detail.clone());
            background_jobs.mark_completed(BACKGROUND_MODERATION_REFRESH_JOB, detail);
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance moderation network request failed"
            );
            emit_background_error(
                runtime_context,
                backend_runtime,
                format!("moderation refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_MODERATION_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_MODERATION_REFRESH_JOB,
        "Next background moderation refresh is waiting.",
        BACKGROUND_MODERATION_CADENCE_SECONDS,
    );
}
