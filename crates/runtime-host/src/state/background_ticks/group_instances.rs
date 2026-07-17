use std::sync::{atomic::AtomicBool, Arc, Mutex};

use serde_json::json;
use vrcx_0_application::{
    refresh_background_group_instances, BackendRuntime, BackgroundCapabilitySession,
    RuntimeBackgroundJobs, WebClient,
};
use vrcx_0_persistence::DatabaseService;

use crate::RuntimeHostContext;

use super::super::{
    background_capability_session, background_capability_session_matches, emit_background_error,
    emit_background_info, gui_maintenance_runtime_mode, read_group_order, AtomicFlagGuard,
    BackendRuntimeFrontendSessionSnapshot, BACKGROUND_FACTS_REFRESH_JOB,
    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
};

pub(in crate::state) async fn run_background_group_instance_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
    refresh_running: &Arc<AtomicBool>,
) {
    let Some(_refresh_guard) = AtomicFlagGuard::try_acquire(refresh_running) else {
        background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background group instance refresh is already running.",
            BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
        );
        return;
    };
    background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background group instance facts.",
    );
    let Some(session) = background_capability_session(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background group instance refresh is waiting for an authenticated session.",
            BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
        );
        return;
    };
    runtime_context
        .event_bus
        .emit_runtime_group_instances_projection(json!({
            "status": "running",
            "userId": &session.current_user_id,
            "endpoint": &session.endpoint,
        }));
    match refresh_background_group_instances(web.as_ref(), db.as_ref(), &session).await {
        Ok(refresh) => {
            if !background_capability_session_matches(session_slot, &session) {
                tracing::warn!("ignored stale background group instance refresh");
                emit_stale_group_instance_refresh_idle(session_slot, runtime_context, &session);
                background_jobs.mark_scheduled(
                    BACKGROUND_FACTS_REFRESH_JOB,
                    "Stale background group instance refresh ignored.",
                    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
                );
                return;
            }
            let count = refresh.instances.len();
            runtime_context
                .event_bus
                .emit_runtime_group_instances_projection(json!({
                    "status": "ready",
                    "userId": &session.current_user_id,
                    "endpoint": &session.endpoint,
                    "instances": refresh.instances,
                    "groupOrder": read_group_order(&session.current_user_id),
                    "fetchedAt": refresh.fetched_at,
                }));
            let detail = format!("group instance facts refreshed: {count} rows.");
            emit_background_info(runtime_context, backend_runtime, detail.clone());
            background_jobs.mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
        }
        Err(error) => {
            if !background_capability_session_matches(session_slot, &session) {
                tracing::warn!("ignored stale background group instance refresh error");
                emit_stale_group_instance_refresh_idle(session_slot, runtime_context, &session);
                background_jobs.mark_scheduled(
                    BACKGROUND_FACTS_REFRESH_JOB,
                    "Stale background group instance refresh error ignored.",
                    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
                );
                return;
            }
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance group instance network request failed"
            );
            runtime_context
                .event_bus
                .emit_runtime_group_instances_projection(json!({
                    "status": "error",
                    "userId": &session.current_user_id,
                    "endpoint": &session.endpoint,
                    "error": error.to_string(),
                }));
            emit_background_error(
                runtime_context,
                backend_runtime,
                format!("group instance refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Next background group instance facts refresh is waiting.",
        BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
    );
}

fn emit_stale_group_instance_refresh_idle(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    runtime_context: &Arc<RuntimeHostContext>,
    session: &BackgroundCapabilitySession,
) {
    let same_scope = background_capability_session(session_slot)
        .map(|current| {
            current.current_user_id == session.current_user_id
                && current.endpoint == session.endpoint
        })
        .unwrap_or(false);
    if same_scope {
        runtime_context
            .event_bus
            .emit_runtime_group_instances_projection(json!({
                "status": "idle",
                "userId": &session.current_user_id,
                "endpoint": &session.endpoint,
            }));
        return;
    }
    runtime_context
        .event_bus
        .emit_runtime_group_instances_projection(json!({
            "status": "idle",
            "userId": &session.current_user_id,
            "endpoint": &session.endpoint,
            "instances": [],
            "groupOrder": [],
        }));
}
