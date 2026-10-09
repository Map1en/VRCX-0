use std::sync::Arc;

use super::{
    current_user_from_cookie, run_background_group_instance_refresh, AtomicFlagGuard,
    AuthenticatedRuntimeSession, BackendRuntimePhase, BackendRuntimeSnapshot,
    BackendRuntimeTelemetryKind, BackgroundTickContext, CliLoginPrompt, GuiRuntimeMode,
    NonInteractiveAuthError, PrintCleanupDeps, PrintCleanupTrigger, Result, RuntimeHostProfile,
    RuntimeHostState,
};

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
        self.group_ban_import.cancel();
        self.shared_collection_import.cancel();
        self.note_export.cancel();
        self.backend_runtime
            .set_phase(BackendRuntimePhase::Stopping);
        self.authenticated_runtime.stop();
        if let Some(extension) = &self.profile_extension {
            extension.stop_profile_services();
        }
        self.backend_runtime
            .set_ws_status(vrcx_0_core::realtime::RealtimeWsStatus::Idle);
        self.backend_runtime
            .set_game_log_status(vrcx_0_application_core::BackendRuntimeGameLogStatus::Idle);
        self.backend_runtime
            .set_process_status(vrcx_0_application_core::BackendRuntimeProcessStatus::Unknown);
        self.backend_runtime.set_phase(BackendRuntimePhase::Idle);
        self.emit_backend_runtime_telemetry(BackendRuntimeTelemetryKind::RuntimeStopped, reason);
        self.backend_runtime.snapshot()
    }

    pub fn set_gui_backend_runtime_mode(&self, mode: GuiRuntimeMode) -> BackendRuntimeSnapshot {
        let current = self.backend_runtime.snapshot();
        match self.profile {
            RuntimeHostProfile::Desktop => {}
            RuntimeHostProfile::HeadlessData => return current,
        }
        let snapshot = self.backend_runtime.set_gui_mode(mode);
        if snapshot.phase == BackendRuntimePhase::Running {
            self.start_social_maintenance_loops();
            self.start_profile_maintenance_loops();
        }
        let detail = mode.as_str();
        self.emit_backend_runtime_telemetry_snapshot(
            BackendRuntimeTelemetryKind::ModeChanged,
            detail,
            snapshot.clone(),
        );
        snapshot
    }

    pub fn clear_backend_authenticated_session(
        &self,
        reason: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        self.runtime_context.auth_scope.set_identity("", "", "");
        self.favorite_import.cancel();
        self.group_ban_import.cancel();
        self.shared_collection_import.cancel();
        self.note_export.cancel();
        let _ = self.runtime_context.mutual_graph_fetch.cancel_active();
        self.clear_authenticated_session_projection();
        let snapshot = self.backend_runtime.clear_authentication();
        self.emit_backend_runtime_telemetry_snapshot(
            BackendRuntimeTelemetryKind::AuthCleared,
            reason,
            snapshot.clone(),
        );
        snapshot
    }

    pub fn begin_frontend_authentication(&self) -> BackendRuntimeSnapshot {
        self.clear_backend_authenticated_session("Starting a frontend login session.");
        self.backend_runtime.set_authenticating()
    }

    pub async fn refresh_runtime_group_instances(&self) {
        let context = BackgroundTickContext {
            db: &self.db,
            realtime_store: &self.realtime_store,
            web: &self.web,
            session_slot: &self.authenticated_session_projection,
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
        mode: GuiRuntimeMode,
        cli_login_prompt: Option<Arc<dyn CliLoginPrompt>>,
    ) -> Result<BackendRuntimeSnapshot> {
        if self.profile != RuntimeHostProfile::Desktop {
            return Err(crate::Error::Custom(
                "GUI backend runtime requires the Desktop host profile.".into(),
            ));
        }
        self.start_backend_runtime_inner(Some(mode), cli_login_prompt)
            .await
    }

    pub async fn start_headless_backend_runtime(
        &self,
        cli_login_prompt: Option<Arc<dyn CliLoginPrompt>>,
    ) -> Result<BackendRuntimeSnapshot> {
        if self.profile != RuntimeHostProfile::HeadlessData {
            return Err(crate::Error::Custom(
                "Headless backend runtime requires the HeadlessData host profile.".into(),
            ));
        }
        self.start_backend_runtime_inner(None, cli_login_prompt)
            .await
    }

    async fn start_backend_runtime_inner(
        &self,
        gui_mode: Option<GuiRuntimeMode>,
        cli_login_prompt: Option<Arc<dyn CliLoginPrompt>>,
    ) -> Result<BackendRuntimeSnapshot> {
        let Some(_start_guard) = AtomicFlagGuard::try_acquire(&self.backend_starting) else {
            return Ok(self.backend_runtime.snapshot());
        };
        let current = self.backend_runtime.snapshot();
        if matches!(
            current.phase,
            BackendRuntimePhase::Starting
                | BackendRuntimePhase::Authenticating
                | BackendRuntimePhase::Running
        ) {
            if let Some(mode) = gui_mode {
                self.backend_runtime.set_gui_mode(mode);
            }
            if current.phase == BackendRuntimePhase::Running {
                self.start_social_maintenance_loops();
                self.start_profile_maintenance_loops();
            }
            return Ok(self.backend_runtime.snapshot());
        }

        if let Some(mode) = gui_mode {
            self.backend_runtime.set_gui_mode(mode);
        }
        self.backend_runtime
            .set_phase(BackendRuntimePhase::Starting);
        self.start_data_services();
        if let Some(extension) = &self.profile_extension {
            extension.start_profile_services(self);
        }

        self.backend_runtime.set_authenticating();
        let authenticated_session = self.authenticated_session_projection().session;
        let interactive_login = cli_login_prompt.is_some();
        let auth_result = if let Some(prompt) = cli_login_prompt {
            self.authenticate_cli_interactive(prompt).await
        } else if let Some(session) = authenticated_session {
            current_user_from_cookie(
                self.runtime_context.login_api.as_ref(),
                session.user_id,
                session.endpoint,
                session.websocket,
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
                return Err(crate::Error::AuthInteractionRequired(reason));
            }
            Err(NonInteractiveAuthError::SessionInvalidated {
                user_id,
                reason,
                status_code,
            }) => {
                self.clear_invalid_non_interactive_auth_session(&user_id, &reason);
                return Err(crate::Error::AuthSessionInvalidated {
                    reason,
                    status_code,
                });
            }
            Err(NonInteractiveAuthError::Failed(reason)) => {
                self.backend_runtime.set_auth_error(reason.clone());
                return Err(crate::Error::Custom(reason));
            }
        };

        if interactive_login {
            Ok(self.backend_runtime.snapshot())
        } else {
            self.start_authenticated_runtime_session(session)
        }
    }

    pub fn start_authenticated_runtime_session(
        &self,
        session: AuthenticatedRuntimeSession,
    ) -> Result<BackendRuntimeSnapshot> {
        let result = self.start_authenticated_runtime_session_inner(session);
        if let Err(error) = &result {
            self.clear_backend_authenticated_session(error.to_string());
        }
        result
    }

    fn start_authenticated_runtime_session_inner(
        &self,
        session: AuthenticatedRuntimeSession,
    ) -> Result<BackendRuntimeSnapshot> {
        if session.user_id.trim().is_empty() {
            return Err(crate::Error::Custom(
                "Authenticated runtime requires an authenticated user id.".into(),
            ));
        }
        let auth_scope = self.runtime_context.auth_scope.set_identity(
            &session.user_id,
            &session.display_name,
            &session.endpoint,
        );
        let activity_warmup_user_id = session.user_id.clone();
        vrcx_0_application::auth::initialize_authenticated_session_storage(
            &vrcx_0_outbound_adapters::LocalAuthenticatedSessionStorage::new(Arc::clone(&self.db)),
            &session.user_id,
        )?;
        let snapshot = self
            .backend_runtime
            .set_auth_success(session.user_id.clone(), session.display_name.clone());
        self.emit_backend_runtime_telemetry_snapshot(
            BackendRuntimeTelemetryKind::AuthSuccess,
            session.display_name.clone(),
            snapshot,
        );

        let print_cleanup_trigger = PrintCleanupTrigger {
            user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            reason: "baseline".to_string(),
        };
        self.runtime_context.print_cleanup.schedule(
            &self.runtime_context.tasks,
            PrintCleanupDeps::new(
                self.runtime_context.print_adapter.clone(),
                self.runtime_context.print_adapter.clone(),
                self.runtime_context.event_bus.clone(),
                self.runtime_context.auth_scope.clone(),
                Arc::clone(&self.runtime_context.remote_mutations),
            ),
            print_cleanup_trigger,
        );
        self.backend_runtime.set_phase(BackendRuntimePhase::Running);
        self.establish_authenticated_session_projection(&session, auth_scope.generation);
        self.authenticated_runtime.start(session)?;
        self.activity_warmup
            .schedule(activity_warmup_user_id, auth_scope.generation);
        self.start_social_maintenance_loops();
        self.start_profile_maintenance_loops();
        self.authenticated_session_maintenance.schedule(auth_scope);
        Ok(self.backend_runtime.snapshot())
    }
}
