use super::*;

impl RuntimeHostState {
    pub(super) fn start_social_maintenance_loops(&self) {
        let current = self.backend_runtime.snapshot();
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        let active_runtime = is_authenticated_maintenance_active_snapshot(&current, &auth_scope);
        let active_session =
            background_session_scope_matches_auth(&self.backend_frontend_session, &auth_scope);
        if !active_runtime || !active_session {
            return;
        }
        if self.social_maintenance_running.swap(true, Ordering::AcqRel) {
            return;
        }

        for (name, cadence, detail) in [
            (
                BACKGROUND_FACTS_REFRESH_JOB,
                BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
                "Background facts refresh is scheduled.",
            ),
            (
                BACKGROUND_MODERATION_REFRESH_JOB,
                BACKGROUND_MODERATION_CADENCE_SECONDS,
                "Background moderation refresh is scheduled.",
            ),
            (
                BACKGROUND_PRINT_CLEANUP_JOB,
                BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS,
                "Print auto cleanup fallback is scheduled.",
            ),
        ] {
            self.runtime_context.background_jobs.register_job(
                name,
                "rust-host",
                Some(cadence),
                "scheduled",
                detail,
            );
        }

        let db = Arc::clone(&self.db);
        let web = Arc::clone(&self.web);
        let backend_runtime = self.backend_runtime.clone();
        let background_jobs = self.runtime_context.background_jobs.clone();
        let running = Arc::clone(&self.social_maintenance_running);
        let group_instances_refresh_running =
            Arc::clone(&self.background_group_instances_refresh_running);
        let session_slot = Arc::clone(&self.backend_frontend_session);
        let realtime_runtime = Arc::clone(&self.realtime_runtime);
        let authenticated_runtime = self.authenticated_runtime.clone();
        let runtime_context = Arc::clone(&self.runtime_context);
        let group_order_source = Arc::clone(&self.group_order_source);

        self.runtime_context
            .tasks
            .spawn_cancellable(move |stop_token| async move {
                let mut next_current_user = Instant::now();
                let mut next_group_instances = Instant::now();
                let mut next_social = Instant::now()
                    + Duration::from_secs(BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS);
                let mut next_moderation = Instant::now();
                let mut next_print_cleanup = Instant::now();
                let mut favorite_friend_groups_by_key: HashMap<String, Vec<String>> =
                    HashMap::new();
                let mut favorite_groups_initialized = false;
                let mut active_scope_key =
                    background_capability_session_scope_key(&session_slot).unwrap_or_default();
                let sleep_chunk = Duration::from_secs(1);

                loop {
                    if stop_token.is_stop_requested()
                        || !is_authenticated_maintenance_active(
                            &backend_runtime,
                            &runtime_context,
                            &session_slot,
                        )
                    {
                        break;
                    }

                    let now = Instant::now();
                    let scope_key =
                        background_capability_session_scope_key(&session_slot).unwrap_or_default();
                    if scope_key != active_scope_key {
                        active_scope_key = scope_key;
                        favorite_friend_groups_by_key.clear();
                        favorite_groups_initialized = false;
                        next_current_user = now;
                        next_group_instances = now;
                        next_social = now
                            + Duration::from_secs(BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS);
                        next_moderation = now;
                        next_print_cleanup = now;
                    }

                    let tick_context = BackgroundTickContext {
                        db: &db,
                        web: &web,
                        session_slot: &session_slot,
                        realtime_runtime: &realtime_runtime,
                        runtime_context: &runtime_context,
                        backend_runtime: &backend_runtime,
                        background_jobs: &background_jobs,
                        authenticated_runtime: &authenticated_runtime,
                    };

                    if now >= next_current_user {
                        run_background_current_user_refresh(
                            &db,
                            &web,
                            &session_slot,
                            &realtime_runtime,
                            &runtime_context,
                            &backend_runtime,
                            &background_jobs,
                        )
                        .await;
                        next_current_user =
                            now + Duration::from_secs(BACKGROUND_CURRENT_USER_CADENCE_SECONDS);
                    }

                    if now >= next_group_instances {
                        run_background_group_instance_refresh(
                            &tick_context,
                            &group_instances_refresh_running,
                            group_order_source.as_ref(),
                        )
                        .await;
                        next_group_instances =
                            now + Duration::from_secs(BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS);
                    }

                    if !favorite_groups_initialized {
                        let snapshot = authenticated_runtime.snapshot();
                        if let Some(favorites) = snapshot
                            .favorites_baseline
                            .as_ref()
                            .and_then(|baseline| baseline.snapshot.as_ref())
                        {
                            favorite_friend_groups_by_key =
                                crate::authenticated_runtime::favorite_group_membership_from_snapshot(
                                    favorites.as_value(),
                                );
                            favorite_groups_initialized = true;
                        }
                    }

                    if now >= next_social {
                        run_background_social_baseline_refresh(
                            &tick_context,
                            &mut favorite_friend_groups_by_key,
                        )
                        .await;
                        next_social =
                            now + Duration::from_secs(BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS);
                    }

                    if now >= next_moderation {
                        run_background_moderation_refresh(
                            &db,
                            &web,
                            &session_slot,
                            &runtime_context,
                            &backend_runtime,
                            &background_jobs,
                        )
                        .await;
                        next_moderation =
                            now + Duration::from_secs(BACKGROUND_MODERATION_CADENCE_SECONDS);
                    }

                    if now >= next_print_cleanup {
                        run_background_print_cleanup(&tick_context);
                        next_print_cleanup =
                            now + Duration::from_secs(BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS);
                    }

                    tokio::time::sleep(sleep_chunk).await;
                }

                running.store(false, Ordering::Release);
                background_jobs.mark_completed(
                    BACKGROUND_FACTS_REFRESH_JOB,
                    "Background facts refresh stopped.",
                );
                background_jobs.mark_completed(
                    BACKGROUND_MODERATION_REFRESH_JOB,
                    "Background moderation refresh stopped.",
                );
                background_jobs.mark_completed(
                    BACKGROUND_PRINT_CLEANUP_JOB,
                    "Print auto cleanup fallback stopped.",
                );
            });
    }

    pub(super) fn start_profile_maintenance_loops(&self) {
        if let Some(extension) = &self.profile_extension {
            extension.start_profile_maintenance(self);
        }
    }

    pub(super) fn emit_backend_runtime_telemetry(&self, kind: &str, detail: impl Into<String>) {
        self.emit_backend_runtime_telemetry_snapshot(kind, detail, self.backend_runtime.snapshot());
    }

    pub(super) fn emit_backend_runtime_telemetry_snapshot(
        &self,
        kind: &str,
        detail: impl Into<String>,
        snapshot: BackendRuntimeSnapshot,
    ) {
        self.runtime_context
            .event_bus
            .emit(BackendRuntimeTelemetry {
                kind: kind.into(),
                detail: detail.into(),
                snapshot,
            });
    }
}

pub(super) fn is_authenticated_maintenance_active(
    runtime: &BackendRuntime,
    runtime_context: &Arc<RuntimeHostContext>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
) -> bool {
    let auth_scope = runtime_context.auth_scope.snapshot();
    if !is_authenticated_maintenance_active_snapshot(&runtime.snapshot(), &auth_scope) {
        return false;
    }
    background_capability_session(session_slot)
        .map(|session| background_session_matches_auth(&session, &auth_scope))
        .unwrap_or(auth_scope.active)
}

pub(super) fn is_authenticated_maintenance_active_snapshot(
    snapshot: &BackendRuntimeSnapshot,
    auth_scope: &vrcx_0_application_core::RuntimeAuthScopeSnapshot,
) -> bool {
    snapshot.phase == BackendRuntimePhase::Running
        && snapshot.auth_status == "authenticated"
        && !snapshot.auth_user_id.trim().is_empty()
        && auth_scope.active
        && auth_scope.current_user_id == snapshot.auth_user_id
}

pub(super) fn background_session_scope_matches_auth(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    auth_scope: &vrcx_0_application_core::RuntimeAuthScopeSnapshot,
) -> bool {
    background_capability_session(session_slot)
        .map(|session| background_session_matches_auth(&session, auth_scope))
        .unwrap_or(false)
}

pub(super) fn background_session_matches_auth(
    session: &BackgroundCapabilitySession,
    auth_scope: &vrcx_0_application_core::RuntimeAuthScopeSnapshot,
) -> bool {
    auth_scope.active
        && session.current_user_id == auth_scope.current_user_id
        && normalize_vrchat_api_endpoint(Some(&session.endpoint)) == auth_scope.endpoint
}

pub(super) fn gui_maintenance_runtime_mode(backend_runtime: &BackendRuntime) -> &'static str {
    match backend_runtime.snapshot().mode {
        BackendRuntimeMode::Foreground => "normal GUI mode",
        BackendRuntimeMode::Background => "background GUI mode",
        BackendRuntimeMode::Headless => "headless mode",
    }
}

pub(super) fn emit_background_info(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(runtime_context, backend_runtime, "backgroundInfo", detail);
}

pub(super) fn emit_background_error(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(runtime_context, backend_runtime, "backgroundError", detail);
}

fn emit_background_output(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    kind: &str,
    detail: impl Into<String>,
) {
    let snapshot = backend_runtime.snapshot();
    if snapshot.mode == BackendRuntimeMode::Headless
        || !matches!(snapshot.phase, BackendRuntimePhase::Running)
    {
        return;
    }
    runtime_context.event_bus.emit(BackendRuntimeTelemetry {
        kind: kind.into(),
        detail: detail.into(),
        snapshot,
    });
}

pub(super) fn background_capability_session(
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

fn background_capability_session_scope_key(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
) -> Option<String> {
    background_capability_session(session_slot).map(|session| {
        format!(
            "{}:{}",
            session.current_user_id,
            normalize_vrchat_api_endpoint(Some(&session.endpoint))
        )
    })
}

pub(super) fn background_capability_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    session: &BackgroundCapabilitySession,
) -> bool {
    session_slot_matches(session_slot.lock().ok().as_deref(), session)
}
