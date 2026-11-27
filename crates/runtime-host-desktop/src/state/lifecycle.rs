use vrcx_0_application_core::RuntimeOperationStatus;

use crate::ancillary_snapshot::{ancillary_runtime_snapshot, AncillaryRuntimeSnapshot};
use vrcx_0_application_core::{GuiRuntimeMode, RuntimeEventSink};
use vrcx_0_application_realtime::RealtimeTransportStartResult;
use vrcx_0_composition::{BackendRuntimeCombinedSnapshot, Result};

use super::{DesktopRuntimeHostState, RuntimeJobRecordInput};

impl DesktopRuntimeHostState {
    pub fn start_telemetry_runtime(&self) {
        self.desktop.telemetry.start();
    }

    pub fn start_game_services(&self) {
        self.extension.start_game_services(&self.runtime);
    }

    pub fn start_desktop_services(&self) {
        self.extension.start_desktop_services(&self.runtime);
    }

    pub fn backend_runtime_combined_snapshot(&self) -> BackendRuntimeCombinedSnapshot {
        self.runtime.backend_runtime_combined_snapshot()
    }

    pub async fn refresh_runtime_group_instances(&self) {
        self.runtime.refresh_runtime_group_instances().await;
    }

    pub fn record_runtime_job(&self, input: RuntimeJobRecordInput) {
        let name = input.name.trim();
        if name.is_empty() {
            return;
        }
        let detail = input.detail.trim();
        let jobs = self.runtime.desktop_assembly().background_jobs();
        jobs.register_job(
            name,
            input.owner.trim(),
            input.cadence_seconds,
            input.status,
            detail,
        );
        match input.status {
            RuntimeOperationStatus::Running => jobs.mark_running(name, detail),
            RuntimeOperationStatus::Completed | RuntimeOperationStatus::Idle => {
                jobs.mark_completed(name, detail)
            }
            RuntimeOperationStatus::Error => jobs.mark_failed(name, detail),
            status => jobs.register_job(
                name,
                input.owner.trim(),
                input.cadence_seconds,
                status,
                detail,
            ),
        }
    }

    pub(crate) fn host_session_projection(&self) -> vrcx_0_application_core::HostSessionProjection {
        self.runtime
            .desktop_assembly()
            .session()
            .projection_snapshot()
    }

    pub(crate) fn profile_backup_status(&self) -> vrcx_0_application::profile::ProfileBackupStatus {
        self.runtime.profile_backup().current_status()
    }

    pub(crate) fn data_dir_migration_status(
        &self,
    ) -> vrcx_0_application::profile::DataDirMigrationStatus {
        self.runtime.data_dir_migration().current_status()
    }

    pub fn backend_runtime_snapshot(&self) -> vrcx_0_application_core::BackendRuntimeSnapshot {
        self.runtime.snapshot_backend_runtime()
    }

    pub async fn start_gui_backend_runtime(
        &self,
        mode: GuiRuntimeMode,
    ) -> Result<vrcx_0_application_core::BackendRuntimeSnapshot> {
        self.runtime.start_backend_runtime(mode, None).await
    }

    pub fn set_gui_backend_runtime_mode(
        &self,
        mode: GuiRuntimeMode,
    ) -> vrcx_0_application_core::BackendRuntimeSnapshot {
        self.runtime.set_gui_backend_runtime_mode(mode)
    }

    pub async fn recover_background_auth_after_failure(&self, reason: String) {
        self.runtime
            .recover_background_auth_after_failure(reason)
            .await;
    }

    pub fn retry_realtime_now(&self) {
        self.runtime.authenticated_runtime().retry_now();
    }

    pub fn active_realtime_transport(&self) -> Option<RealtimeTransportStartResult> {
        self.runtime
            .authenticated_runtime()
            .snapshot()
            .realtime_transport
    }

    pub fn add_authenticated_runtime_phase_observer(
        &self,
        observer: vrcx_0_application::auth::AuthenticatedRuntimePhaseObserver,
    ) {
        self.runtime
            .authenticated_runtime()
            .add_phase_observer(observer);
    }

    pub fn set_runtime_event_sink<S>(&self, sink: S)
    where
        S: RuntimeEventSink + 'static,
    {
        self.runtime.set_event_sink(sink);
    }

    pub fn set_runtime_host_actions<A>(&self, actions: A)
    where
        A: crate::RuntimeHostActions + 'static,
    {
        self.desktop.services.host.set_actions(actions);
    }

    pub fn start_data_services(&self) {
        self.runtime.start_data_services();
    }

    pub fn record_lifecycle_phase(
        &self,
        phase: impl Into<String>,
        status: RuntimeOperationStatus,
        detail: impl Into<String>,
    ) {
        self.runtime
            .desktop_assembly()
            .lifecycle()
            .record_phase(phase, status, detail);
    }

    pub fn record_sync(
        &self,
        domain: impl Into<String>,
        status: RuntimeOperationStatus,
        detail: impl Into<String>,
        pending_count: u64,
    ) {
        self.runtime
            .desktop_assembly()
            .sync()
            .record(domain, status, detail, pending_count);
    }

    pub fn record_sync_failure(&self, domain: impl Into<String>, detail: impl Into<String>) {
        self.runtime
            .desktop_assembly()
            .sync()
            .record_failure(domain, detail);
    }

    pub fn launched_from_autostart(&self) -> bool {
        self.runtime.launched_from_autostart()
    }

    pub fn stop_for_application_exit(&self, reason: &str, flush_telemetry: impl FnOnce()) {
        self.desktop.desktop_widget.shutdown();
        self.runtime.stop_backend_runtime(reason);
        flush_telemetry();
        self.runtime.desktop_assembly().tasks().stop_all();
    }

    pub fn release_profile_lock(&self) {
        self.runtime.release_profile_lock();
    }

    pub fn set_autostart_preference(
        &self,
        platform: &dyn crate::AutostartPlatform,
        enabled: bool,
    ) -> Result<bool> {
        crate::set_autostart_preference(
            self.runtime.desktop_assembly().config_store().as_ref(),
            platform,
            enabled,
        )
    }

    pub async fn ancillary_runtime_snapshot(&self) -> AncillaryRuntimeSnapshot {
        ancillary_runtime_snapshot(self).await
    }
}
