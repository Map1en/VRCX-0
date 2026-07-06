use super::*;

pub(super) struct BackgroundTickContext<'a> {
    pub(super) db: &'a Arc<DatabaseService>,
    pub(super) web: &'a Arc<WebClient>,
    pub(super) session_slot: &'a Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    pub(super) realtime_runtime: &'a Arc<RealtimeHostRuntime>,
    pub(super) vr_overlay_runtime: &'a Arc<VrOverlayRuntime>,
    pub(super) runtime_context: &'a Arc<RuntimeHostContext>,
    pub(super) backend_runtime: &'a BackendRuntime,
    pub(super) background_jobs: &'a RuntimeBackgroundJobs,
}

pub(super) async fn run_background_presence_tick(
    context: &BackgroundTickContext<'_>,
    presence_state: &mut BackgroundPresenceAutomationState,
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        "Running background presence automation.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_PRESENCE_AUTOMATION_JOB,
            "Background presence automation is waiting for an authenticated session.",
            BACKGROUND_PRESENCE_CADENCE_SECONDS,
        );
        return;
    };
    let host_session = context.runtime_context.session.snapshot();
    let friends_by_id = context
        .realtime_runtime
        .friend_snapshot()
        .map(|snapshot| snapshot.friends_by_id)
        .unwrap_or_default();
    let facts = match build_background_presence_facts(
        context.db.as_ref(),
        BackgroundPresenceFactsInput {
            session: session.clone(),
            is_game_running: host_session.is_game_running,
            is_steamvr_running: host_session.is_steamvr_running,
            last_game_started_at: host_session.last_game_started_at,
            game_log_snapshot: context.runtime_context.game_log_snapshot(),
            now_playing: context.runtime_context.now_playing(),
            friends_by_id,
            favorite_friend_groups_by_key: favorite_friend_groups_by_key.clone(),
        },
    ) {
        Ok(facts) => facts,
        Err(error) => {
            tracing::warn!(error = %error, "background presence facts build failed");
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("presence automation facts failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_PRESENCE_AUTOMATION_JOB, error.to_string());
            return;
        }
    };
    let result = match run_background_presence_automation(
        context.runtime_context.config(),
        context.web.as_ref(),
        context.db.as_ref(),
        &facts,
        presence_state,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            tracing::warn!(error = %error, "background presence automation failed");
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("presence automation failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_PRESENCE_AUTOMATION_JOB, error.to_string());
            return;
        }
    };
    if let Some(updated_user) = result.updated_user.clone() {
        let overlay_patch = result.patch.clone();
        let accepted = context
            .realtime_runtime
            .sync_current_user_snapshot(
                session.current_user_id.clone(),
                session.endpoint.clone(),
                session.websocket.clone(),
                None,
                updated_user.clone(),
                overlay_patch,
            )
            .unwrap_or(false);
        if !background_capability_session_matches(context.session_slot, &session) {
            tracing::warn!("ignored stale background presence automation user update");
        } else if accepted {
            if let Some(snapshot) = context.realtime_runtime.current_user_snapshot() {
                replace_backend_frontend_session_user_if_session_matches(
                    context.session_slot,
                    &session,
                    &snapshot,
                );
            } else {
                update_backend_frontend_session_user_if_session_matches(
                    context.session_slot,
                    &session,
                    &updated_user,
                );
            }
        } else {
            tracing::warn!("ignored background presence automation update rejected by realtime");
        }
    }
    if result.applied {
        tracing::info!(
            patch = %result.patch,
            rules = ?result.matched_rule_ids,
            "background presence automation applied"
        );
        emit_background_info(
            context.runtime_context,
            context.backend_runtime,
            background_presence_applied_detail(&result.patch, result.matched_rule_ids.len()),
        );
    }
    context.background_jobs.mark_completed(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        format!("Background presence automation tick: {}.", result.reason),
    );
    context.background_jobs.mark_scheduled(
        BACKGROUND_PRESENCE_AUTOMATION_JOB,
        "Next background presence automation tick is waiting.",
        BACKGROUND_PRESENCE_CADENCE_SECONDS,
    );
}

pub(super) async fn run_background_discord_tick(
    context: &BackgroundTickContext<'_>,
    discord_rpc: &Arc<DiscordRpc>,
    discord_state: &mut BackgroundDiscordPresenceState,
    discord_success_info: &mut Option<String>,
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_DISCORD_PRESENCE_JOB,
        "Running background Discord presence.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_DISCORD_PRESENCE_JOB,
            "Background Discord presence is waiting for an authenticated session.",
            BACKGROUND_DISCORD_CADENCE_SECONDS,
        );
        return;
    };
    let host_session = context.runtime_context.session.snapshot();
    let friends_by_id = context
        .realtime_runtime
        .friend_snapshot()
        .map(|snapshot| snapshot.friends_by_id)
        .unwrap_or_default();
    let facts = match build_background_presence_facts(
        context.db.as_ref(),
        BackgroundPresenceFactsInput {
            session,
            is_game_running: host_session.is_game_running,
            is_steamvr_running: host_session.is_steamvr_running,
            last_game_started_at: host_session.last_game_started_at,
            game_log_snapshot: context.runtime_context.game_log_snapshot(),
            now_playing: context.runtime_context.now_playing(),
            friends_by_id,
            favorite_friend_groups_by_key: favorite_friend_groups_by_key.clone(),
        },
    ) {
        Ok(facts) => facts,
        Err(error) => {
            tracing::warn!(error = %error, "background Discord facts build failed");
            *discord_success_info = None;
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("Discord presence facts failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
            return;
        }
    };
    let command = match build_background_discord_presence_command(
        context.runtime_context.config(),
        context.web.as_ref(),
        context.db.as_ref(),
        &facts,
        discord_state,
        false,
    )
    .await
    {
        Ok(command) => command,
        Err(error) => {
            tracing::warn!(error = %error, "background Discord presence compose failed");
            *discord_success_info = None;
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("Discord presence compose failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
            return;
        }
    };

    let detail = match command {
        BackgroundDiscordPresenceCommand::Noop { detail } => detail,
        BackgroundDiscordPresenceCommand::SetActive { active, detail, .. } => {
            let rpc = Arc::clone(discord_rpc);
            match tokio::task::spawn_blocking(move || rpc.set_active(active)).await {
                Ok(Ok(result)) => {
                    discord_state.apply_set_active_result(result);
                    emit_background_info_if_changed(
                        context.runtime_context,
                        context.backend_runtime,
                        discord_success_info,
                        format!(
                            "Discord presence {}: {detail}",
                            if active { "connected" } else { "cleared" }
                        ),
                    );
                    detail
                }
                Ok(Err(error)) => {
                    discord_state.apply_set_active_result(false);
                    tracing::warn!(error = %error, "background Discord SetActive failed");
                    *discord_success_info = None;
                    emit_background_error(
                        context.runtime_context,
                        context.backend_runtime,
                        format!("Discord SetActive failed: {error}."),
                    );
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
                Err(error) => {
                    discord_state.apply_set_active_result(false);
                    tracing::warn!(error = %error, "background Discord SetActive task failed");
                    *discord_success_info = None;
                    emit_background_error(
                        context.runtime_context,
                        context.backend_runtime,
                        format!("Discord SetActive task failed: {error}."),
                    );
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
            }
        }
        BackgroundDiscordPresenceCommand::SetAssets { payload } => {
            let detail = payload.detail.clone();
            let rpc = Arc::clone(discord_rpc);
            let payload = json!({
                "appId": payload.app_id,
                "activity": payload.activity,
            });
            match tokio::task::spawn_blocking(move || rpc.set_assets(payload)).await {
                Ok(Ok(result)) => {
                    discord_state.apply_set_assets_result(result);
                    emit_background_info_if_changed(
                        context.runtime_context,
                        context.backend_runtime,
                        discord_success_info,
                        format!("Discord activity sent: {detail}"),
                    );
                    detail
                }
                Ok(Err(error)) => {
                    discord_state.apply_set_assets_result(false);
                    tracing::warn!(error = %error, "background Discord SetAssets failed");
                    *discord_success_info = None;
                    emit_background_error(
                        context.runtime_context,
                        context.backend_runtime,
                        format!("Discord SetAssets failed: {error}."),
                    );
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
                Err(error) => {
                    discord_state.apply_set_assets_result(false);
                    tracing::warn!(error = %error, "background Discord SetAssets task failed");
                    *discord_success_info = None;
                    emit_background_error(
                        context.runtime_context,
                        context.backend_runtime,
                        format!("Discord SetAssets task failed: {error}."),
                    );
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
            }
        }
    };
    context
        .background_jobs
        .mark_completed(BACKGROUND_DISCORD_PRESENCE_JOB, detail);
    context.background_jobs.mark_scheduled(
        BACKGROUND_DISCORD_PRESENCE_JOB,
        "Next background Discord presence tick is waiting.",
        BACKGROUND_DISCORD_CADENCE_SECONDS,
    );
}

pub(super) async fn run_background_current_user_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    realtime_runtime: &Arc<RealtimeHostRuntime>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
) {
    background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background current user facts.",
    );
    let Some(session) = background_capability_session(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background facts refresh is waiting for an authenticated session.",
            BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
        );
        return;
    };
    match refresh_background_current_user(web.as_ref(), db.as_ref(), &session).await {
        Ok(updated_user) => {
            let accepted = realtime_runtime
                .sync_current_user_snapshot(
                    session.current_user_id.clone(),
                    session.endpoint.clone(),
                    session.websocket.clone(),
                    None,
                    updated_user.clone(),
                    Value::Null,
                )
                .unwrap_or(false);
            if !background_capability_session_matches(session_slot, &session) {
                tracing::warn!("ignored stale background current user refresh");
            } else if accepted {
                if let Some(snapshot) = realtime_runtime.current_user_snapshot() {
                    replace_backend_frontend_session_user_if_session_matches(
                        session_slot,
                        &session,
                        &snapshot,
                    );
                } else {
                    update_backend_frontend_session_user_filtered_if_session_matches(
                        session_slot,
                        &session,
                        &updated_user,
                    );
                }
            } else {
                tracing::warn!("ignored background current user refresh rejected by realtime");
            }
            let detail = "current user facts refreshed.";
            emit_background_info(runtime_context, backend_runtime, detail);
            background_jobs.mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance current user network request failed"
            );
            emit_background_error(
                runtime_context,
                backend_runtime,
                format!("current user refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Next background current user facts refresh is waiting.",
        BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
    );
}

pub(super) async fn run_background_group_instance_refresh(
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

pub(super) fn run_background_print_cleanup(context: &BackgroundTickContext<'_>) {
    context.background_jobs.mark_running(
        BACKGROUND_PRINT_CLEANUP_JOB,
        "Scheduling print auto cleanup.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_PRINT_CLEANUP_JOB,
            "Print auto cleanup is waiting for an authenticated session.",
            BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS,
        );
        return;
    };

    context.runtime_context.print_cleanup.schedule(
        &context.runtime_context.tasks,
        PrintCleanupDeps {
            db: Arc::clone(context.db),
            web: Arc::clone(context.web),
            event_bus: context.runtime_context.event_bus.clone(),
        },
        PrintCleanupTrigger {
            user_id: session.current_user_id,
            endpoint: session.endpoint,
            reason: "background".to_string(),
        },
    );
    context
        .background_jobs
        .mark_completed(BACKGROUND_PRINT_CLEANUP_JOB, "Print auto cleanup queued.");
    context.background_jobs.mark_scheduled(
        BACKGROUND_PRINT_CLEANUP_JOB,
        "Next print auto cleanup fallback is waiting.",
        BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS,
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

pub(super) async fn run_background_social_baseline_refresh(
    context: &BackgroundTickContext<'_>,
    favorite_friend_groups_by_key: &mut HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Refreshing background friend and favorite facts.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_FACTS_REFRESH_JOB,
            "Background social baseline refresh is waiting for an authenticated session.",
            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
        );
        return;
    };
    let deps = SocialBaselineDeps {
        db: Arc::clone(context.db),
        web: Arc::clone(context.web),
        auth_scope: context.runtime_context.auth_scope.clone(),
        session: context.runtime_context.session.clone(),
    };
    let friend_output = build_friend_roster_baseline(
        deps.clone(),
        SocialFriendRosterBaselineInput {
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: RawJson::from(session.current_user_snapshot.clone()),
            is_first_load: false,
        },
    )
    .await;
    let friend_count = match friend_output {
        Ok(output) => {
            if output.friend_log_changed {
                context
                    .runtime_context
                    .event_bus
                    .emit_realtime_friend_projection(FriendProjection {
                        friend_log_changed: true,
                        ..Default::default()
                    });
            }
            if let Some(snapshot) = output.snapshot {
                let value = snapshot.into_value();
                let friends_value = value
                    .get("friendsById")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                if let Ok(friends_by_id) =
                    serde_json::from_value::<HashMap<String, FriendRecord>>(friends_value.clone())
                {
                    let count = friends_by_id.len();
                    context
                        .runtime_context
                        .overlay_activity
                        .set_friend_user_ids(friends_by_id.keys().cloned());
                    let _ = context.realtime_runtime.sync_friend_snapshot(
                        session.current_user_id.clone(),
                        session.endpoint.clone(),
                        session.websocket.clone(),
                        None,
                        friends_by_id,
                    );
                    if let Ok(favorites_output) = build_favorites_baseline(
                        deps,
                        SocialFavoritesBaselineInput {
                            user_id: session.current_user_id.clone(),
                            endpoint: session.endpoint.clone(),
                            current_user_snapshot: RawJson::from(
                                session.current_user_snapshot.clone(),
                            ),
                            friend_roster_by_id: RawJson::from(friends_value),
                        },
                    )
                    .await
                    {
                        if let Some(snapshot) = favorites_output.snapshot {
                            let value = snapshot.into_value();
                            context
                                .vr_overlay_runtime
                                .update_friends_panel_favorite_groups_from_baseline(&value);
                            let groups = favorite_group_membership_from_snapshot(value);
                            context
                                .runtime_context
                                .overlay_activity
                                .set_favorite_groups(OverlayFavoriteGroups::from_map(
                                    groups.clone(),
                                ));
                            *favorite_friend_groups_by_key = groups;
                        }
                    }
                    count
                } else {
                    output.count
                }
            } else {
                output.count
            }
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                error = %error,
                "GUI maintenance social baseline network request failed"
            );
            emit_background_error(
                context.runtime_context,
                context.backend_runtime,
                format!("social baseline refresh failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_FACTS_REFRESH_JOB, error.to_string());
            return;
        }
    };
    let detail = format!("friend and favorite facts refreshed: {friend_count} friends.");
    emit_background_info(
        context.runtime_context,
        context.backend_runtime,
        detail.clone(),
    );
    context
        .background_jobs
        .mark_completed(BACKGROUND_FACTS_REFRESH_JOB, detail);
    context.background_jobs.mark_scheduled(
        BACKGROUND_FACTS_REFRESH_JOB,
        "Next background friend and favorite facts refresh is waiting.",
        BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
    );
}

pub(super) async fn run_background_moderation_refresh(
    db: &Arc<DatabaseService>,
    web: &Arc<WebClient>,
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
) {
    background_jobs.mark_running(
        BACKGROUND_MODERATION_REFRESH_JOB,
        "Refreshing background moderation facts.",
    );
    let Some(session) = background_capability_session(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_MODERATION_REFRESH_JOB,
            "Background moderation refresh is waiting for an authenticated session.",
            BACKGROUND_MODERATION_CADENCE_SECONDS,
        );
        return;
    };
    let deps = ModerationSyncDeps {
        db: db.as_ref(),
        web: web.as_ref(),
        session: &runtime_context.session,
        auth_scope: &runtime_context.auth_scope,
    };
    match refresh_player_moderations(
        deps,
        ModerationSyncRefreshInput {
            user_id: session.current_user_id,
            endpoint: session.endpoint,
        },
    )
    .await
    {
        Ok(output) => {
            let detail = format!(
                "moderation facts refreshed: {} local rows.",
                output.local_count
            );
            emit_background_info(runtime_context, backend_runtime, detail.clone());
            background_jobs.mark_completed(BACKGROUND_MODERATION_REFRESH_JOB, detail);
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance moderation network request failed"
            );
            emit_background_error(
                runtime_context,
                backend_runtime,
                format!("moderation refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_MODERATION_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_MODERATION_REFRESH_JOB,
        "Next background moderation refresh is waiting.",
        BACKGROUND_MODERATION_CADENCE_SECONDS,
    );
}

fn background_presence_applied_detail(patch: &Value, matched_rule_count: usize) -> String {
    let fields = patch
        .as_object()
        .map(|object| {
            let mut fields = object.keys().cloned().collect::<Vec<_>>();
            fields.sort();
            fields.join(", ")
        })
        .filter(|fields| !fields.is_empty())
        .unwrap_or_else(|| "none".into());
    format!("presence automation applied: fields {fields}; matched rules {matched_rule_count}.")
}
