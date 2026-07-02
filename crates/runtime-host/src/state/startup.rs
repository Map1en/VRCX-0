use super::*;

impl RuntimeHostState {
    pub fn stop_backend_runtime(&self, reason: impl Into<String>) -> BackendRuntimeSnapshot {
        let reason = reason.into();
        self.backend_runtime
            .set_phase(BackendRuntimePhase::Stopping);
        self.realtime_runtime.stop(RealtimeStopRequest::default());
        self.vr_overlay_runtime.stop();
        self.process_monitor.stop();
        self.log_watcher.stop();
        self.game_log_runtime.stop();
        self.game_client_runtime.stop();
        self.backend_runtime.set_ws_status("idle");
        self.backend_runtime.set_game_log_status("idle");
        self.backend_runtime.set_process_status("unknown");
        self.backend_runtime.set_phase(BackendRuntimePhase::Idle);
        self.emit_backend_runtime_telemetry("runtimeStopped", reason);
        self.backend_runtime.snapshot()
    }

    pub fn set_gui_backend_runtime_mode(&self, mode: BackendRuntimeMode) -> BackendRuntimeSnapshot {
        let current = self.backend_runtime.snapshot();
        if current.mode == BackendRuntimeMode::Headless || mode == BackendRuntimeMode::Headless {
            return current;
        }
        let snapshot = self.backend_runtime.set_mode(mode);
        if snapshot.mode == BackendRuntimeMode::Background
            && snapshot.phase == BackendRuntimePhase::Running
        {
            self.start_gui_background_registry_backup_loop();
        }
        if snapshot.phase == BackendRuntimePhase::Running {
            self.start_gui_background_capability_loops();
        }
        let detail = match mode {
            BackendRuntimeMode::Foreground => "foreground",
            BackendRuntimeMode::Background => "background",
            BackendRuntimeMode::Headless => "headless",
        };
        self.emit_backend_runtime_telemetry_snapshot("modeChanged", detail, snapshot.clone());
        snapshot
    }

    pub fn wait_for_gui_background_capability_loops_stopped(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while self.background_capabilities_running.load(Ordering::Acquire) {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        true
    }

    pub fn clear_backend_authenticated_session(
        &self,
        reason: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        self.clear_backend_frontend_session();
        let snapshot = self.backend_runtime.clear_authentication();
        self.emit_backend_runtime_telemetry_snapshot("authCleared", reason, snapshot.clone());
        snapshot
    }

    pub async fn refresh_runtime_group_instances(&self) {
        run_background_group_instance_refresh(
            &self.db,
            &self.web,
            &self.backend_frontend_session,
            &self.runtime_context,
            &self.backend_runtime,
            &self.runtime_context.background_jobs,
            &self.background_group_instances_refresh_running,
        )
        .await;
    }

    pub async fn start_backend_runtime(
        &self,
        mode: BackendRuntimeMode,
        force_cli_login: bool,
    ) -> Result<BackendRuntimeSnapshot> {
        let Some(_start_guard) = BackendStartGuard::try_acquire(&self.backend_starting) else {
            return Ok(self.backend_runtime.snapshot());
        };
        let current = self.backend_runtime.snapshot();
        if matches!(
            current.phase,
            BackendRuntimePhase::Starting
                | BackendRuntimePhase::Authenticating
                | BackendRuntimePhase::Running
        ) {
            self.backend_runtime.set_mode(mode);
            if mode == BackendRuntimeMode::Background
                && current.phase == BackendRuntimePhase::Running
            {
                self.start_gui_background_registry_backup_loop();
            }
            if current.phase == BackendRuntimePhase::Running {
                self.start_gui_background_capability_loops();
            }
            return Ok(self.backend_runtime.snapshot());
        }

        self.backend_runtime.set_mode(mode);
        self.backend_runtime
            .set_phase(BackendRuntimePhase::Starting);
        self.start_shell_neutral_services();

        self.backend_runtime.set_authenticating();
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        let auth_result = if force_cli_login {
            self.authenticate_cli_interactive().await
        } else if auth_scope.active {
            current_user_from_cookie(
                self.web.as_ref(),
                self.db.as_ref(),
                auth_scope.current_user_id.clone(),
                auth_scope.endpoint.clone(),
                String::new(),
            )
            .await
        } else {
            self.authenticate_non_interactive().await
        };
        let session = match auth_result {
            Ok(session) => session,
            Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                self.backend_runtime
                    .set_auth_interaction_required(reason.clone());
                return Err(crate::Error::Custom(reason));
            }
            Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason }) => {
                self.clear_invalid_non_interactive_auth_session(&user_id, &reason);
                return Err(crate::Error::Custom(reason));
            }
            Err(NonInteractiveAuthError::Failed(reason)) => {
                self.backend_runtime.set_auth_error(reason.clone());
                return Err(crate::Error::Custom(reason));
            }
        };

        self.runtime_context
            .auth_scope
            .set(&session.user_id, &session.endpoint);
        vrcx_0_persistence::maintenance::user_tables_ensure(
            self.db.as_ref(),
            session.user_id.clone(),
        )?;
        let snapshot = self
            .backend_runtime
            .set_auth_success(session.user_id.clone(), session.display_name.clone());
        self.emit_backend_runtime_telemetry_snapshot(
            "authSuccess",
            session.display_name.clone(),
            snapshot,
        );

        let social_baseline = match self.build_backend_social_baseline(&session).await {
            Ok(social_baseline) => social_baseline,
            Err(error) => {
                tracing::warn!(error = %error, "failed to build backend social baseline");
                BackendSocialBaseline::default()
            }
        };
        self.set_backend_frontend_session(&session);
        self.runtime_context
            .overlay_activity
            .set_favorite_groups(OverlayFavoriteGroups::from_map(
                social_baseline.favorite_groups,
            ));
        let print_cleanup_trigger = PrintCleanupTrigger {
            user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            reason: "baseline".to_string(),
        };
        self.realtime_runtime.start(
            session.user_id,
            session.endpoint,
            session.websocket,
            0,
            session.current_user,
            social_baseline.friends_by_id,
        )?;
        self.runtime_context.print_cleanup.schedule(
            &self.runtime_context.tasks,
            PrintCleanupDeps {
                db: Arc::clone(&self.db),
                web: Arc::clone(&self.web),
                event_bus: self.runtime_context.event_bus.clone(),
            },
            print_cleanup_trigger,
        );
        self.backend_runtime.set_phase(BackendRuntimePhase::Running);
        if self.backend_runtime.snapshot().mode == BackendRuntimeMode::Background {
            self.start_gui_background_registry_backup_loop();
        }
        self.start_gui_background_capability_loops();
        Ok(self.backend_runtime.snapshot())
    }
}
