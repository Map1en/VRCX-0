use std::sync::{Arc, Mutex};

use serde_json::Value;
use vrcx_0_application::{
    refresh_background_current_user, BackendRuntime, RealtimeHostRuntime, RuntimeBackgroundJobs,
    WebClient,
};
use vrcx_0_persistence::DatabaseService;

use crate::RuntimeHostContext;

use super::super::{
    background_capability_session, background_capability_session_matches, emit_background_error,
    emit_background_info, gui_maintenance_runtime_mode,
    replace_backend_frontend_session_user_if_session_matches,
    update_backend_frontend_session_user_filtered_if_session_matches,
    BackendRuntimeFrontendSessionSnapshot, BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
    BACKGROUND_FACTS_REFRESH_JOB,
};

pub(in crate::state) async fn run_background_current_user_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    realtime_runtime: &Arc<RealtimeHostRuntime>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
) {
    background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background current user facts.",
    );
    let Some(session) = background_capability_session(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background facts refresh is waiting for an authenticated session.",
            BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
        );
        return;
    };
    match refresh_background_current_user(web.as_ref(), db.as_ref(), &session).await {
        Ok(updated_user) => {
            let accepted = realtime_runtime
                .sync_current_user_snapshot(
                    session.current_user_id.clone(),
                    session.endpoint.clone(),
                    session.websocket.clone(),
                    None,
                    updated_user.clone(),
                    Value::Null,
                )
                .unwrap_or(false);
            if !background_capability_session_matches(session_slot, &session) {
                tracing::warn!("ignored stale background current user refresh");
            } else if accepted {
                if let Some(snapshot) = realtime_runtime.current_user_snapshot() {
                    replace_backend_frontend_session_user_if_session_matches(
                        session_slot,
                        &session,
                        &snapshot,
                    );
                } else {
                    update_backend_frontend_session_user_filtered_if_session_matches(
                        session_slot,
                        &session,
                        &updated_user,
                    );
                }
            } else {
                tracing::warn!("ignored background current user refresh rejected by realtime");
            }
            let detail = "current user facts refreshed.";
            emit_background_info(runtime_context, backend_runtime, detail);
            background_jobs.mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance current user network request failed"
            );
            emit_background_error(
                runtime_context,
                backend_runtime,
                format!("current user refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Next background current user facts refresh is waiting.",
        BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
    );
}
