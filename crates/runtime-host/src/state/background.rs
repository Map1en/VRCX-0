use super::*;

impl RuntimeHostState {
    pub(super) fn start_gui_background_registry_backup_loop(&self) {
        let current = self.backend_runtime.snapshot();
        if current.mode != BackendRuntimeMode::Background
            || current.phase != BackendRuntimePhase::Running
        {
            return;
        }
        if !is_host_capability_available(HostCapability::RegistryPrefs) {
            self.runtime_context.background_jobs.register_job(
                REGISTRY_BACKUP_MAINTENANCE_JOB,
                "rust-host",
                Some(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS),
                "unavailable",
                "Registry backup maintenance is unavailable on this platform.",
            );
            return;
        }
        if self
            .registry_backup_maintenance_running
            .swap(true, Ordering::AcqRel)
        {
            return;
        }

        self.runtime_context.background_jobs.register_job(
            REGISTRY_BACKUP_MAINTENANCE_JOB,
            "rust-host",
            Some(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS),
            "scheduled",
            "Registry backup maintenance is scheduled for background mode.",
        );

        let db = Arc::clone(&self.db);
        let backend_runtime = self.backend_runtime.clone();
        let runtime_context = Arc::clone(&self.runtime_context);
        let background_jobs = self.runtime_context.background_jobs.clone();
        let running = Arc::clone(&self.registry_backup_maintenance_running);
        let registry_backup_lock = Arc::clone(&self.registry_backup_lock);
        self.runtime_context.tasks.spawn_cancellable_thread(
            "registry-backup-maintenance",
            move |stop_token| {
                let host = HostRegistryBackupActions;
                let cadence = Duration::from_secs(REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS);
                let sleep_chunk = Duration::from_secs(5);

                loop {
                    if stop_token.is_stop_requested()
                        || !is_background_registry_maintenance_active(&backend_runtime)
                    {
                        break;
                    }

                    background_jobs.mark_running(
                        REGISTRY_BACKUP_MAINTENANCE_JOB,
                        "Running background registry backup maintenance.",
                    );
                    let result = match registry_backup_lock.lock() {
                        Ok(_guard) => vrcx_0_application::registry_backup_maintenance_run(
                            db.as_ref(),
                            &host,
                            RegistryBackupMaintenanceMode::Silent,
                            "background-mode",
                        ),
                        Err(error) => Err(vrcx_0_application::Error::Custom(format!(
                            "registry backup lock poisoned: {error}"
                        ))),
                    };
                    match result {
                        Ok(result) => {
                            if result.auto_backup_created {
                                tracing::info!("background mode registry auto backup created");
                                emit_background_info(
                                    &runtime_context,
                                    &backend_runtime,
                                    result.detail.clone(),
                                );
                            }
                            background_jobs
                                .mark_completed(REGISTRY_BACKUP_MAINTENANCE_JOB, result.detail);
                            background_jobs.mark_scheduled(
                                REGISTRY_BACKUP_MAINTENANCE_JOB,
                                "Next background registry backup maintenance run is waiting.",
                                REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS,
                            );
                        }
                        Err(error) => {
                            tracing::warn!(
                                error = %error,
                                "background registry backup maintenance failed"
                            );
                            emit_background_error(
                                &runtime_context,
                                &backend_runtime,
                                format!("registry backup maintenance failed: {error}."),
                            );
                            background_jobs
                                .mark_failed(REGISTRY_BACKUP_MAINTENANCE_JOB, error.to_string());
                            background_jobs.mark_scheduled(
                                REGISTRY_BACKUP_MAINTENANCE_JOB,
                                "Next background registry backup maintenance retry is waiting.",
                                REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS,
                            );
                        }
                    }

                    let mut remaining = cadence;
                    while remaining > Duration::ZERO {
                        if stop_token.is_stop_requested()
                            || !is_background_registry_maintenance_active(&backend_runtime)
                        {
                            running.store(false, Ordering::Release);
                            background_jobs.mark_completed(
                                REGISTRY_BACKUP_MAINTENANCE_JOB,
                                "Background registry backup maintenance stopped.",
                            );
                            return;
                        }
                        let chunk = remaining.min(sleep_chunk);
                        std::thread::sleep(chunk);
                        remaining = remaining.saturating_sub(chunk);
                    }
                }

                running.store(false, Ordering::Release);
                background_jobs.mark_completed(
                    REGISTRY_BACKUP_MAINTENANCE_JOB,
                    "Background registry backup maintenance stopped.",
                );
            },
        );
    }

    pub(super) fn start_gui_background_capability_loops(&self) {
        let current = self.backend_runtime.snapshot();
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        let active_runtime =
            is_authenticated_gui_maintenance_active_snapshot(&current, &auth_scope);
        let active_session =
            background_session_scope_matches_auth(&self.backend_frontend_session, &auth_scope);
        if !active_runtime || !active_session {
            return;
        }
        if self
            .background_capabilities_running
            .swap(true, Ordering::AcqRel)
        {
            return;
        }

        for (name, cadence, detail) in [
            (
                BACKGROUND_PRESENCE_AUTOMATION_JOB,
                BACKGROUND_PRESENCE_CADENCE_SECONDS,
                "Background presence automation is scheduled for GUI background mode.",
            ),
            (
                BACKGROUND_DISCORD_PRESENCE_JOB,
                BACKGROUND_DISCORD_CADENCE_SECONDS,
                "Background Discord presence is scheduled for GUI background mode.",
            ),
            (
                BACKGROUND_FACTS_REFRESH_JOB,
                BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
                "Background facts refresh is scheduled for GUI background mode.",
            ),
            (
                BACKGROUND_MODERATION_REFRESH_JOB,
                BACKGROUND_MODERATION_CADENCE_SECONDS,
                "Background moderation refresh is scheduled for GUI background mode.",
            ),
            (
                BACKGROUND_PRINT_CLEANUP_JOB,
                BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS,
                "Print auto cleanup fallback is scheduled for GUI background mode.",
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
        let running = Arc::clone(&self.background_capabilities_running);
        let group_instances_refresh_running =
            Arc::clone(&self.background_group_instances_refresh_running);
        let session_slot = Arc::clone(&self.backend_frontend_session);
        let realtime_runtime = Arc::clone(&self.realtime_runtime);
        let authenticated_runtime = self.authenticated_runtime.clone();
        let vr_overlay_runtime = Arc::clone(&self.vr_overlay_runtime);
        let runtime_context = Arc::clone(&self.runtime_context);
        let discord_rpc = Arc::clone(&self.discord_rpc);
        let discord_reconcile_generation = Arc::clone(&self.discord_reconcile_generation);

        self.runtime_context
            .tasks
            .spawn_cancellable(move |stop_token| async move {
                let mut presence_state = BackgroundPresenceAutomationState::default();
                let mut discord_state = BackgroundDiscordPresenceState::default();
                let mut discord_success_info: Option<String> = None;
                let mut next_presence = Instant::now();
                let mut next_discord = Instant::now();
                let mut observed_discord_reconcile_generation =
                    discord_reconcile_generation.load(Ordering::Acquire);
                let mut next_current_user = Instant::now();
                let mut next_group_instances = Instant::now();
                let mut next_overlay_activity_config = Instant::now();
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
                        || !is_authenticated_gui_maintenance_active(
                            &backend_runtime,
                            &runtime_context,
                            &session_slot,
                        )
                    {
                        break;
                    }

                    let now = Instant::now();
                    if observe_discord_reconcile_request(
                        discord_reconcile_generation.as_ref(),
                        &mut observed_discord_reconcile_generation,
                    ) {
                        next_discord = now;
                    }
                    let scope_key =
                        background_capability_session_scope_key(&session_slot).unwrap_or_default();
                    if scope_key != active_scope_key {
                        active_scope_key = scope_key;
                        presence_state = BackgroundPresenceAutomationState::default();
                        discord_state = BackgroundDiscordPresenceState::default();
                        discord_success_info = None;
                        favorite_friend_groups_by_key.clear();
                        favorite_groups_initialized = false;
                        runtime_context.overlay_activity.clear_runtime_state();
                        vr_overlay_runtime.clear_friends_panel_session_state();
                        next_presence = now;
                        next_discord = now;
                        next_current_user = now;
                        next_group_instances = now;
                        next_overlay_activity_config = now;
                        next_social = now
                            + Duration::from_secs(BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS);
                        next_moderation = now;
                        next_print_cleanup = now;
                    }

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
                            &db,
                            &web,
                            &session_slot,
                            &runtime_context,
                            &backend_runtime,
                            &background_jobs,
                            &group_instances_refresh_running,
                        )
                        .await;
                        next_group_instances =
                            now + Duration::from_secs(BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS);
                    }

                    if now >= next_overlay_activity_config {
                        runtime_context.reload_overlay_activity_filters();
                        next_overlay_activity_config = now
                            + Duration::from_secs(
                                BACKGROUND_OVERLAY_ACTIVITY_CONFIG_CADENCE_SECONDS,
                            );
                    }

                    let tick_context = BackgroundTickContext {
                        db: &db,
                        web: &web,
                        session_slot: &session_slot,
                        realtime_runtime: &realtime_runtime,
                        vr_overlay_runtime: &vr_overlay_runtime,
                        runtime_context: &runtime_context,
                        backend_runtime: &backend_runtime,
                        background_jobs: &background_jobs,
                        authenticated_runtime: &authenticated_runtime,
                    };

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

                    if now >= next_presence {
                        run_background_presence_tick(
                            &tick_context,
                            &mut presence_state,
                            &favorite_friend_groups_by_key,
                        )
                        .await;
                        next_presence =
                            now + Duration::from_secs(BACKGROUND_PRESENCE_CADENCE_SECONDS);
                    }

                    if now >= next_discord {
                        run_background_discord_tick(
                            &tick_context,
                            &discord_rpc,
                            &mut discord_state,
                            &mut discord_success_info,
                            &favorite_friend_groups_by_key,
                        )
                        .await;
                        next_discord =
                            now + Duration::from_secs(BACKGROUND_DISCORD_CADENCE_SECONDS);
                    }

                    tokio::time::sleep(sleep_chunk).await;
                }

                running.store(false, Ordering::Release);
                background_jobs.mark_completed(
                    BACKGROUND_PRESENCE_AUTOMATION_JOB,
                    "Background presence automation stopped.",
                );
                background_jobs.mark_completed(
                    BACKGROUND_DISCORD_PRESENCE_JOB,
                    "Background Discord presence stopped.",
                );
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

    pub(super) fn emit_backend_runtime_telemetry(&self, kind: &str, detail: impl Into<String>) {
        self.emit_backend_runtime_telemetry_snapshot(kind, detail, self.backend_runtime.snapshot());
    }

    pub(super) fn emit_backend_runtime_telemetry_snapshot(
        &self,
        kind: &str,
        detail: impl Into<String>,
        snapshot: BackendRuntimeSnapshot,
    ) {
        self.runtime_context.event_bus.emit(
            "backendRuntimeTelemetry",
            BackendRuntimeTelemetry {
                kind: kind.into(),
                detail: detail.into(),
                snapshot,
            },
        );
    }
}

pub(super) fn is_background_registry_maintenance_active(runtime: &BackendRuntime) -> bool {
    let snapshot = runtime.snapshot();
    snapshot.mode == BackendRuntimeMode::Background
        && snapshot.phase == BackendRuntimePhase::Running
}

pub(super) fn is_authenticated_gui_maintenance_active(
    runtime: &BackendRuntime,
    runtime_context: &Arc<RuntimeHostContext>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
) -> bool {
    let auth_scope = runtime_context.auth_scope.snapshot();
    if !is_authenticated_gui_maintenance_active_snapshot(&runtime.snapshot(), &auth_scope) {
        return false;
    }
    background_capability_session(session_slot)
        .map(|session| background_session_matches_auth(&session, &auth_scope))
        .unwrap_or(auth_scope.active)
}

pub(super) fn is_authenticated_gui_maintenance_active_snapshot(
    snapshot: &BackendRuntimeSnapshot,
    auth_scope: &vrcx_0_application::RuntimeAuthScopeSnapshot,
) -> bool {
    snapshot.mode != BackendRuntimeMode::Headless
        && snapshot.phase == BackendRuntimePhase::Running
        && snapshot.auth_status == "authenticated"
        && !snapshot.auth_user_id.trim().is_empty()
        && auth_scope.active
        && auth_scope.current_user_id == snapshot.auth_user_id
}

pub(super) fn background_session_scope_matches_auth(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    auth_scope: &vrcx_0_application::RuntimeAuthScopeSnapshot,
) -> bool {
    background_capability_session(session_slot)
        .map(|session| background_session_matches_auth(&session, auth_scope))
        .unwrap_or(false)
}

pub(super) fn background_session_matches_auth(
    session: &BackgroundCapabilitySession,
    auth_scope: &vrcx_0_application::RuntimeAuthScopeSnapshot,
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

pub(super) fn emit_background_info_if_changed(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    last_detail: &mut Option<String>,
    detail: impl Into<String>,
) {
    let detail = detail.into();
    if last_detail.as_deref() == Some(detail.as_str()) {
        return;
    }
    emit_background_info(runtime_context, backend_runtime, detail.clone());
    *last_detail = Some(detail);
}

pub(super) fn emit_background_output(
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
    runtime_context.event_bus.emit(
        "backendRuntimeTelemetry",
        BackendRuntimeTelemetry {
            kind: kind.into(),
            detail: detail.into(),
            snapshot,
        },
    );
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

pub(super) fn background_capability_session_scope_key(
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

pub(super) fn read_group_order(user_id: &str) -> Value {
    if !is_host_capability_available(HostCapability::RegistryPrefs) {
        return json!([]);
    }
    let key = format!("VRC_GROUP_ORDER_{}", user_id.trim());
    let Ok(raw) = vrcx_0_host::vrchat_registry::get_registry_key_string(&key) else {
        return json!([]);
    };
    match serde_json::from_str::<Value>(&raw) {
        Ok(value) if value.is_array() => value,
        _ => json!([]),
    }
}

fn observe_discord_reconcile_request(generation: &AtomicU64, observed: &mut u64) -> bool {
    let requested = generation.load(Ordering::Acquire);
    if requested == *observed {
        return false;
    }
    *observed = requested;
    true
}

#[cfg(test)]
mod discord_reconcile_tests {
    use super::*;

    #[test]
    fn observes_each_reconcile_generation_once() {
        let generation = AtomicU64::new(0);
        let mut observed = 0;

        assert!(!observe_discord_reconcile_request(
            &generation,
            &mut observed
        ));
        generation.fetch_add(1, Ordering::AcqRel);
        assert!(observe_discord_reconcile_request(
            &generation,
            &mut observed
        ));
        assert_eq!(observed, 1);
        assert!(!observe_discord_reconcile_request(
            &generation,
            &mut observed
        ));
    }
}
