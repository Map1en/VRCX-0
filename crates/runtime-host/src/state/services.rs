use super::*;

impl RuntimeHostState {
    pub fn release_profile_lock(&self) {
        self._profile_lock.release();
    }

    pub fn start_shell_neutral_services(&self) {
        let host_capabilities = current_host_capabilities();
        tracing::info!(
            platform = %host_capabilities.platform,
            "host capabilities resolved"
        );
        self.runtime_context
            .runtime
            .set_host_services_started(true, "Runtime host services installed.");
        self.runtime_context
            .background_jobs
            .register_frontend_job_catalog();
        self.runtime_context.background_jobs.register_job(
            "startupRecovery",
            "rust-host",
            None,
            "checkpoint",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
        );
        self.runtime_context.runtime.record_phase(
            "startupRecovery",
            "checkpoint",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
        );
        self.runtime_context.sync.record(
            "startupRecovery",
            "observed",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
            0,
        );
        self.runtime_context
            .background_jobs
            .start_database_optimize_loop(Arc::clone(&self.db), self.runtime_context.tasks.clone());
        self.app_update
            .start_loop(self.runtime_context.tasks.clone());
        self.profile_backup.start_scheduler();

        self.start_log_watcher_for_current_platform(&host_capabilities);

        if is_host_capability_available(HostCapability::GameProcessMonitor) {
            let vr_overlay_process_sink: Arc<dyn GameProcessEventSink> =
                Arc::new(VrOverlayProcessSink::new(
                    self.vr_overlay_runtime.clone(),
                    self.log_watcher.clone(),
                ));
            let game_process_sinks: Vec<Arc<dyn GameProcessEventSink>> = vec![
                self.session_runtime.clone(),
                self.game_log_runtime.clone(),
                self.game_client_runtime.clone(),
                self.realtime_runtime.clone(),
                vr_overlay_process_sink,
            ];
            self.process_monitor.start(
                crate::HostGameProcessMonitorActions::new(self.auto_launch.clone()),
                self.log_watcher.clone(),
                game_process_sinks,
            );
            self.runtime_context
                .background_jobs
                .mark_running("gameProcessMonitor", "Game process monitor is active.");
        } else {
            self.runtime_context.background_jobs.register_job(
                "gameProcessMonitor",
                "rust-host",
                None,
                "unavailable",
                "Game process monitor capability is unavailable.",
            );
        }
    }

    fn start_log_watcher_for_current_platform(
        &self,
        _host_capabilities: &vrcx_0_host::host_capabilities::HostCapabilities,
    ) {
        #[cfg(target_os = "windows")]
        if is_host_capability_available(HostCapability::GameLogWatcher) {
            let local_low = std::env::var("LOCALAPPDATA")
                .map(|p| PathBuf::from(p).join("..\\LocalLow\\VRChat\\VRChat"))
                .unwrap_or_default();
            if let Err(error) = self.game_log_runtime.prime_log_watcher(&self.log_watcher) {
                tracing::warn!("failed to prime GameLog watcher from runtime DB: {error}");
            }
            self.log_watcher.start(local_low);
            self.runtime_context
                .background_jobs
                .mark_running("gameLogWatcher", "Windows GameLog watcher is active.");
            self.emit_game_log_watcher_status("running");
        }

        #[cfg(target_os = "windows")]
        if !is_host_capability_available(HostCapability::GameLogWatcher) {
            self.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                "GameLog watcher capability is unavailable.",
            );
            self.emit_game_log_watcher_status("unavailable");
        }

        #[cfg(target_os = "linux")]
        if is_host_capability_available(HostCapability::GameLogWatcher) {
            match vrcx_0_host::vrchat_paths::discover_linux_vrchat_log_paths() {
                Ok(paths) => {
                    let latest_log = paths
                        .latest_log
                        .as_ref()
                        .map(|path| path.display().to_string())
                        .unwrap_or_else(|| "pending".to_string());
                    tracing::info!(
                        log_dir = %paths.app_data.display(),
                        latest_log,
                        "starting Linux GameLog watcher"
                    );
                    if let Err(error) = self.game_log_runtime.prime_log_watcher(&self.log_watcher) {
                        tracing::warn!("failed to prime GameLog watcher from runtime DB: {error}");
                    }
                    self.log_watcher
                        .start_without_process_monitor(paths.app_data);
                    self.runtime_context
                        .background_jobs
                        .mark_running("gameLogWatcher", "Linux GameLog watcher is active.");
                    self.emit_game_log_watcher_status("running");
                }
                Err(reason) => {
                    tracing::warn!(reason, "Linux GameLog watcher is unavailable");
                    self.runtime_context.background_jobs.register_job(
                        "gameLogWatcher",
                        "rust-host",
                        None,
                        "unavailable",
                        reason,
                    );
                    self.emit_game_log_watcher_status("unavailable");
                }
            }
        }

        #[cfg(target_os = "linux")]
        if !is_host_capability_available(HostCapability::GameLogWatcher) {
            self.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                _host_capabilities
                    .game_log_watcher
                    .reason
                    .clone()
                    .unwrap_or_else(|| "GameLog watcher capability is unavailable.".into()),
            );
            self.emit_game_log_watcher_status("unavailable");
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = _host_capabilities;
            self.runtime_context.background_jobs.register_job(
                "gameLogWatcher",
                "rust-host",
                None,
                "unavailable",
                "GameLog watcher is unavailable on this platform.",
            );
            self.emit_game_log_watcher_status("unavailable");
        }
    }

    fn emit_game_log_watcher_status(&self, status: &str) {
        let snapshot = self.backend_runtime.set_game_log_status(status);
        self.emit_backend_runtime_telemetry_snapshot("gameLogWatcher", status, snapshot);
    }
}
