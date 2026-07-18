use std::sync::{atomic::AtomicBool, Arc, Mutex};

use vrcx_0_application::refresh_background_group_instances;
use vrcx_0_application_core::BackgroundCapabilitySession;

use crate::{GroupOrderSource, RuntimeGroupInstancesProjection, RuntimeHostContext};

use super::super::{
    background_capability_session, background_capability_session_matches, emit_background_error,
    emit_background_info, gui_maintenance_runtime_mode, AtomicFlagGuard,
    BackendRuntimeFrontendSessionSnapshot, BACKGROUND_FACTS_REFRESH_JOB,
    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
};
use super::BackgroundTickContext;

pub(in crate::state) async fn run_background_group_instance_refresh(
    context: &BackgroundTickContext<'_>,
    refresh_running: &Arc<AtomicBool>,
    group_order_source: &dyn GroupOrderSource,
) {
    let Some(_refresh_guard) = AtomicFlagGuard::try_acquire(refresh_running) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background group instance refresh is already running.",
            BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
        );
        return;
    };
    context.background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background group instance facts.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background group instance refresh is waiting for an authenticated session.",
            BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
        );
        return;
    };
    context
        .runtime_context
        .event_bus
        .emit(RuntimeGroupInstancesProjection {
            status: "running".into(),
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            fetched_at: None,
            error: None,
            instances: None,
            group_order: None,
        });
    match refresh_background_group_instances(context.web.as_ref(), context.db.as_ref(), &session)
        .await
    {
        Ok(refresh) => {
            if !background_capability_session_matches(context.session_slot, &session) {
                tracing::warn!("ignored stale background group instance refresh");
                emit_stale_group_instance_refresh_idle(
                    context.session_slot,
                    context.runtime_context,
                    &session,
                );
                context.background_jobs.mark_scheduled(
                    BACKGROUND_FACTS_REFRESH_JOB,
                    "Stale background group instance refresh ignored.",
                    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
                );
                return;
            }
            let count = refresh.instances.len();
            context
                .runtime_context
                .event_bus
                .emit(RuntimeGroupInstancesProjection {
                    status: "ready".into(),
                    user_id: session.current_user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    fetched_at: Some(refresh.fetched_at),
                    error: None,
                    instances: Some(refresh.instances),
                    group_order: Some(
                        group_order_source.read_group_order(&session.current_user_id),
                    ),
                });
            let detail = format!("group instance facts refreshed: {count} rows.");
            emit_background_info(
                context.runtime_context,
                context.backend_runtime,
                detail.clone(),
            );
            context
                .background_jobs
                .mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
        }
        Err(error) => {
            if !background_capability_session_matches(context.session_slot, &session) {
                tracing::warn!("ignored stale background group instance refresh error");
                emit_stale_group_instance_refresh_idle(
                    context.session_slot,
                    context.runtime_context,
                    &session,
                );
                context.background_jobs.mark_scheduled(
                    BACKGROUND_FACTS_REFRESH_JOB,
                    "Stale background group instance refresh error ignored.",
                    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
                );
                return;
            }
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                error = %error,
                "GUI maintenance group instance network request failed"
            );
            context
                .runtime_context
                .event_bus
                .emit(RuntimeGroupInstancesProjection {
                    status: "error".into(),
                    user_id: session.current_user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    fetched_at: None,
                    error: Some(error.to_string()),
                    instances: None,
                    group_order: None,
                });
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("group instance refresh failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
        }
    }
    context.background_jobs.mark_scheduled(
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
            .emit(RuntimeGroupInstancesProjection {
                status: "idle".into(),
                user_id: session.current_user_id.clone(),
                endpoint: session.endpoint.clone(),
                fetched_at: None,
                error: None,
                instances: None,
                group_order: None,
            });
        return;
    }
    runtime_context
        .event_bus
        .emit(RuntimeGroupInstancesProjection {
            status: "idle".into(),
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            fetched_at: None,
            error: None,
            instances: Some(Vec::new()),
            group_order: Some(Vec::new()),
        });
}
