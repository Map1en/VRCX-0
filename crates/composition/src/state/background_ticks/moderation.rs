use std::sync::{Arc, Mutex};

use vrcx_0_application::social::{
    force_refresh_player_moderations, ModerationSyncDeps, ModerationSyncRefreshInput,
};
use vrcx_0_application_core::{BackendRuntime, RuntimeBackgroundJobs, WebClient};
use vrcx_0_persistence::DatabaseService;

use crate::RuntimeHostContext;

use super::super::{
    background_capability_session_identity, emit_background_info, emit_background_warning,
    gui_maintenance_runtime_mode, AuthenticatedSessionProjection,
    BACKGROUND_MODERATION_CADENCE_SECONDS, BACKGROUND_MODERATION_REFRESH_JOB,
};

pub(in crate::state) async fn run_background_moderation_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<AuthenticatedSessionProjection>>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
) {
    background_jobs.mark_running(
        BACKGROUND_MODERATION_REFRESH_JOB,
        "Refreshing background moderation facts.",
    );
    let Some(session) = background_capability_session_identity(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_MODERATION_REFRESH_JOB,
            "Background moderation refresh is waiting for an authenticated session.",
            BACKGROUND_MODERATION_CADENCE_SECONDS,
        );
        return;
    };
    let store = vrcx_0_outbound_adapters::LocalModerationSyncStore::new(Arc::clone(db));
    let remote = vrcx_0_outbound_adapters::VrchatRequestAdapter::new(Arc::clone(web));
    let deps = ModerationSyncDeps::new(
        &store,
        &remote,
        &runtime_context.auth_scope,
        runtime_context.remote_mutations.as_ref(),
    );
    match force_refresh_player_moderations(
        &runtime_context.moderation_sync,
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
            emit_background_warning(
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
