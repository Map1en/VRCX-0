use super::*;

impl RuntimeHostState {
    pub fn stop_backend_runtime(&self, reason: impl Into<String>) -> BackendRuntimeSnapshot {
        let reason = reason.into();
        let current = self.backend_runtime.snapshot();
        if current.phase == BackendRuntimePhase::Idle {
            if let Some(extension) = &self.profile_extension {
                extension.stop_profile_services();
            }
            return current;
        }
        self.favorite_import.cancel();
        self.shared_collection_import.cancel();
        self.note_export.cancel();
        self.backend_runtime
            .set_phase(BackendRuntimePhase::Stopping);
        self.authenticated_runtime.stop();
        if let Some(extension) = &self.profile_extension {
            extension.stop_profile_services();
        }
        self.backend_runtime.set_ws_status("idle");
        self.backend_runtime.set_game_log_status("idle");
        self.backend_runtime.set_process_status("unknown");
        self.backend_runtime.set_phase(BackendRuntimePhase::Idle);
        self.emit_backend_runtime_telemetry("runtimeStopped", reason);
        self.backend_runtime.snapshot()
    }

    pub fn set_gui_backend_runtime_mode(&self, mode: BackendRuntimeMode) -> BackendRuntimeSnapshot {
        let current = self.backend_runtime.snapshot();
        match self.profile {
            RuntimeHostProfile::Desktop => {}
            RuntimeHostProfile::HeadlessData => return current,
        }
        if current.mode == BackendRuntimeMode::Headless || mode == BackendRuntimeMode::Headless {
            return current;
        }
        let snapshot = self.backend_runtime.set_mode(mode);
        if snapshot.phase == BackendRuntimePhase::Running {
            self.start_social_maintenance_loops();
            self.start_profile_maintenance_loops();
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
        while self.social_maintenance_running.load(Ordering::Acquire) {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        self.profile_extension
            .as_ref()
            .map(|extension| extension.wait_for_profile_maintenance_stopped(remaining))
            .unwrap_or(true)
    }

    pub fn clear_backend_authenticated_session(
        &self,
        reason: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        self.favorite_import.cancel();
        self.shared_collection_import.cancel();
        self.note_export.cancel();
        self.clear_backend_frontend_session();
        let snapshot = self.backend_runtime.clear_authentication();
        self.emit_backend_runtime_telemetry_snapshot("authCleared", reason, snapshot.clone());
        snapshot
    }

    pub async fn refresh_runtime_group_instances(&self) {
        let context = BackgroundTickContext {
            db: &self.db,
            web: &self.web,
            session_slot: &self.backend_frontend_session,
            realtime_runtime: &self.realtime_runtime,
            runtime_context: &self.runtime_context,
            backend_runtime: &self.backend_runtime,
            background_jobs: &self.runtime_context.background_jobs,
            authenticated_runtime: &self.authenticated_runtime,
        };
        run_background_group_instance_refresh(
            &context,
            &self.background_group_instances_refresh_running,
            self.group_order_source.as_ref(),
        )
        .await;
    }

    pub async fn start_backend_runtime(
        &self,
        mode: BackendRuntimeMode,
        cli_login_prompt: Option<Arc<dyn CliLoginPrompt>>,
    ) -> Result<BackendRuntimeSnapshot> {
        match (self.profile, mode) {
            (RuntimeHostProfile::Desktop, BackendRuntimeMode::Foreground)
            | (RuntimeHostProfile::Desktop, BackendRuntimeMode::Background)
            | (RuntimeHostProfile::HeadlessData, BackendRuntimeMode::Headless) => {}
            (RuntimeHostProfile::Desktop, BackendRuntimeMode::Headless)
            | (RuntimeHostProfile::HeadlessData, BackendRuntimeMode::Foreground)
            | (RuntimeHostProfile::HeadlessData, BackendRuntimeMode::Background) => {
                return Err(crate::Error::Custom(
                    "Backend runtime mode does not match the configured host profile.".into(),
                ));
            }
        }
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
            if current.phase == BackendRuntimePhase::Running {
                self.start_social_maintenance_loops();
                self.start_profile_maintenance_loops();
            }
            return Ok(self.backend_runtime.snapshot());
        }

        self.backend_runtime.set_mode(mode);
        self.backend_runtime
            .set_phase(BackendRuntimePhase::Starting);
        self.start_data_services();
        if let Some(extension) = &self.profile_extension {
            extension.start_profile_services(self);
        }

        self.backend_runtime.set_authenticating();
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        let auth_result = if let Some(prompt) = cli_login_prompt {
            self.authenticate_cli_interactive(prompt).await
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

        self.start_authenticated_runtime_session(session).await
    }

    pub(super) async fn start_authenticated_runtime_session(
        &self,
        session: AuthenticatedRuntimeSession,
    ) -> Result<BackendRuntimeSnapshot> {
        let auth_scope = self
            .runtime_context
            .auth_scope
            .set(&session.user_id, &session.endpoint);
        let activity_warmup_user_id = session.user_id.clone();
        vrcx_0_persistence::maintenance::user_tables_ensure(
            self.db.as_ref(),
            session.user_id.clone(),
        )?;
        self.run_authenticated_session_maintenance_for_user(&session.user_id)?;
        let snapshot = self
            .backend_runtime
            .set_auth_success(session.user_id.clone(), session.display_name.clone());
        self.emit_backend_runtime_telemetry_snapshot(
            "authSuccess",
            session.display_name.clone(),
            snapshot,
        );

        self.set_backend_frontend_session(&session);
        let print_cleanup_trigger = PrintCleanupTrigger {
            user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            reason: "baseline".to_string(),
        };
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
        self.authenticated_runtime.start(session)?;
        self.schedule_activity_warmup(activity_warmup_user_id, auth_scope.generation);
        self.start_social_maintenance_loops();
        self.start_profile_maintenance_loops();
        Ok(self.backend_runtime.snapshot())
    }
}
