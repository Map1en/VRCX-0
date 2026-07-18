use std::sync::{Arc, Mutex};

use vrcx_0_application_core::{
    BackendRuntime, BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeTelemetry,
    BackgroundCapabilitySession, RuntimeBackgroundJobs,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_runtime_host::{
    replace_backend_frontend_session_user_if_session_matches,
    update_backend_frontend_session_user_if_session_matches, BackendRuntimeFrontendSessionSnapshot,
    RuntimeHostContext,
};

mod discord;
mod presence;

pub(in crate::state) use discord::run_background_discord_tick;
pub(in crate::state) use presence::run_background_presence_tick;

pub(in crate::state) const BACKGROUND_PRESENCE_AUTOMATION_JOB: &str =
    "backgroundPresenceAutomation";
pub(in crate::state) const BACKGROUND_DISCORD_PRESENCE_JOB: &str = "backgroundDiscordPresence";
pub(in crate::state) const BACKGROUND_PRESENCE_CADENCE_SECONDS: u64 = 3;
pub(in crate::state) const BACKGROUND_DISCORD_CADENCE_SECONDS: u64 = 3;

pub(in crate::state) struct BackgroundTickContext<'a> {
    pub(in crate::state) db: &'a Arc<vrcx_0_persistence::DatabaseService>,
    pub(in crate::state) web: &'a Arc<vrcx_0_application_core::WebClient>,
    pub(in crate::state) session_slot:
        &'a Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    pub(in crate::state) realtime_runtime: &'a Arc<RealtimeHostRuntime>,
    pub(in crate::state) runtime_context: &'a Arc<RuntimeHostContext>,
    pub(in crate::state) desktop_services: &'a Arc<crate::DesktopRuntimeServices>,
    pub(in crate::state) backend_runtime: &'a BackendRuntime,
    pub(in crate::state) background_jobs: &'a RuntimeBackgroundJobs,
}

pub(in crate::state) fn background_capability_session(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
) -> Option<BackgroundCapabilitySession> {
    session_slot.lock().ok().and_then(|slot| {
        slot.as_ref().map(|session| BackgroundCapabilitySession {
            current_user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: session.current_user_snapshot.clone(),
        })
    })
}

pub(in crate::state) fn background_capability_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    expected: &BackgroundCapabilitySession,
) -> bool {
    session_slot
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().cloned())
        .map(|current| {
            current.user_id == expected.current_user_id
                && current.endpoint == expected.endpoint
                && current.websocket == expected.websocket
        })
        .unwrap_or(false)
}

pub(in crate::state) fn emit_background_info(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(runtime_context, backend_runtime, "backgroundInfo", detail);
}

pub(in crate::state) fn emit_background_error(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(runtime_context, backend_runtime, "backgroundError", detail);
}

pub(in crate::state) fn emit_background_warning(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(
        runtime_context,
        backend_runtime,
        "backgroundWarning",
        detail,
    );
}

pub(in crate::state) fn emit_background_info_if_changed(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    last_detail: &mut Option<String>,
    detail: impl Into<String>,
) {
    let detail = detail.into();
    if !remember_background_output_if_changed(last_detail, &detail) {
        return;
    }
    emit_background_info(runtime_context, backend_runtime, detail);
}

pub(in crate::state) fn remember_background_output_if_changed(
    last_detail: &mut Option<String>,
    detail: &str,
) -> bool {
    if last_detail.as_deref() == Some(detail) {
        return false;
    }
    *last_detail = Some(detail.into());
    true
}

fn emit_background_output(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    kind: &str,
    detail: impl Into<String>,
) {
    let snapshot = backend_runtime.snapshot();
    if snapshot.mode == BackendRuntimeMode::Headless
        || snapshot.phase != BackendRuntimePhase::Running
    {
        return;
    }
    runtime_context.event_bus.emit(BackendRuntimeTelemetry {
        kind: kind.into(),
        detail: detail.into(),
        snapshot,
    });
}
