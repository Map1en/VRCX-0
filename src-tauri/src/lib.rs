mod adapters;
mod bootstrap;
mod commands;
mod error;
#[cfg(target_os = "macos")]
mod macos_menu;
mod state;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::Emitter;
use tauri::Manager;
use tauri::WindowEvent;
use vrcx_0_application::{BackendRuntimeMode, BackendRuntimePhase};
use vrcx_0_persistence::config::{self as config_store, ConfigWriteEntry};

use state::AppState;

fn refresh_tray_menu(app: &tauri::AppHandle, state: &AppState) {
    if let Err(error) = bootstrap::refresh_tray_menu(app, state) {
        tracing::warn!(error = %error, "failed to refresh tray background mode item");
    }
}

fn stop_background_mode_and_show_window(app: &tauri::AppHandle, state: &AppState) {
    if let Err(error) = bootstrap::restore_foreground_window_from_background_mode(app, state) {
        tracing::warn!(
            error = %error,
            "failed to show main window after stopping background mode"
        );
    }
}

fn hide_window_to_tray(window: &tauri::Window) {
    let _ = window.hide();
    let _ = window.set_skip_taskbar(true);
}

fn auto_background_mode_on_tray_enabled(state: &AppState) -> bool {
    state
        .runtime_context
        .config()
        .get_bool("backgroundModeEnabled", false)
        .unwrap_or(false)
}

fn is_background_mode_hidden(app: &tauri::AppHandle, state: &AppState) -> bool {
    let snapshot = state.snapshot_backend_runtime();
    if snapshot.mode != BackendRuntimeMode::Background
        || snapshot.phase != BackendRuntimePhase::Running
    {
        return false;
    }
    match app.get_webview_window("main") {
        Some(window) => !window.is_visible().unwrap_or(true),
        None => true,
    }
}

fn disable_community_theme_from_tray(app: &tauri::AppHandle, state: &AppState) {
    if let Err(error) = config_store::config_set_values(
        state.db.as_ref(),
        vec![ConfigWriteEntry {
            key: "config:vrcx_communitythemeenabled".into(),
            value: "false".into(),
        }],
    ) {
        tracing::warn!(error = %error, "failed to disable community theme from tray");
    }
    if let Err(error) = app.emit("communityThemeDisableRequested", serde_json::json!({})) {
        tracing::warn!(error = %error, "failed to emit community theme disable request");
    }
    if let Err(error) = bootstrap::refresh_tray_menu(app, state) {
        tracing::warn!(error = %error, "failed to refresh tray menu after disabling community theme");
    }
}

fn start_background_mode_and_hide_window(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        bootstrap::capture_background_resume_route(&app, &state);
        match state
            .start_backend_runtime(BackendRuntimeMode::Background)
            .await
        {
            Ok(snapshot) => {
                let current = state.snapshot_backend_runtime();
                if snapshot.mode == BackendRuntimeMode::Background
                    && current.mode == BackendRuntimeMode::Background
                    && current.phase == BackendRuntimePhase::Running
                {
                    bootstrap::show_background_mode_started_notification(&app, &state);
                    bootstrap::destroy_main_window_for_background_mode(&app);
                }
                refresh_tray_menu(&app, &state);
            }
            Err(error) => {
                bootstrap::show_auth_failure_notification_after_backend_start_error(
                    &app,
                    &state,
                    &error.to_string(),
                );
                tracing::warn!(error = %error, "failed to start background mode from tray");
                refresh_tray_menu(&app, &state);
            }
        }
    });
}

pub fn run() {
    let app_data_dir = match vrcx_0_host::app_paths::resolve_app_data_dir() {
        Ok(resolution) => {
            bootstrap::init_error_logging(Some(resolution.current_dir.clone()));
            resolution
        }
        Err(error) => {
            bootstrap::init_error_logging(None);
            panic!("failed to resolve app data directory: {error}");
        }
    };

    bootstrap::init_tls_crypto_provider();
    bootstrap::apply_linux_webkit_workaround();

    let protocol_paths = std::sync::Arc::new(vrcx_0_host::app_paths::AppPaths::from_app_data(
        app_data_dir.current_dir.clone(),
    ));

    let image_protocol_paths = protocol_paths.clone();
    let thumbnail_protocol_paths = protocol_paths.clone();
    let setup_app_data_dir = app_data_dir.clone();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(state) = app.try_state::<AppState>() {
                if let Err(error) =
                    bootstrap::restore_foreground_window_from_background_mode(app, &state)
                {
                    tracing::warn!(error = %error, "failed to show main window from single instance");
                }
            } else if let Err(error) = bootstrap::ensure_main_window(app) {
                tracing::warn!(error = %error, "failed to show main window from single instance");
            }
        }))
        .register_asynchronous_uri_scheme_protocol("vrcx-0-img", move |_ctx, request, responder| {
            let paths = image_protocol_paths.clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(bootstrap::screenshot_protocol_response(
                    request,
                    paths.as_ref(),
                ));
            });
        })
        .register_asynchronous_uri_scheme_protocol("vrcx-0-thumb", move |_ctx, request, responder| {
            let paths = thumbnail_protocol_paths.clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(bootstrap::screenshot_thumbnail_protocol_response(
                    request,
                    paths.as_ref(),
                ));
            });
        })
        .register_asynchronous_uri_scheme_protocol("vrcx-0-bg-img", move |ctx, request, responder| {
            let app_handle = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let response = match app_handle.try_state::<AppState>() {
                    Some(state) => bootstrap::background_image_protocol_response(request, &state),
                    None => tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::SERVICE_UNAVAILABLE)
                        .body(Vec::new().into())
                        .unwrap(),
                };
                responder.respond(response);
            });
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(bootstrap::updater_public_key())
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        );

    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--autostart"]),
    ));

    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--autostart"]),
    ));

    builder
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let snapshot = state.snapshot_backend_runtime();
                if snapshot.mode == BackendRuntimeMode::Background
                    && snapshot.phase == BackendRuntimePhase::Running
                {
                    return;
                }

                if state.storage.get("VRCX_CloseToTray").as_deref() == Some("true") {
                    api.prevent_close();
                    hide_window_to_tray(window);
                    if auto_background_mode_on_tray_enabled(&state) {
                        start_background_mode_and_hide_window(window.app_handle().clone());
                    }
                } else {
                    commands::host::window::stop_runtime_services(window.app_handle());
                }
            }
        })
        .on_tray_icon_event(|app, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Err(error) =
                        bootstrap::restore_foreground_window_from_background_mode(app, &state)
                    {
                        tracing::warn!(error = %error, "failed to show main window from tray");
                    }
                } else if let Err(error) = bootstrap::ensure_main_window(app) {
                    tracing::warn!(error = %error, "failed to show main window from tray");
                }
            }
            _ => {}
        })
        .setup(move |app| bootstrap::setup_app_with_data_dir(app, setup_app_data_dir.clone()))
        .on_menu_event(|app, event| {
            match event.id().0.as_str() {
                "tray-open" => {
                    if let Some(state) = app.try_state::<AppState>() {
                        if let Err(error) =
                            bootstrap::restore_foreground_window_from_background_mode(app, &state)
                        {
                            tracing::warn!(
                                error = %error,
                                "failed to open main window from tray menu"
                            );
                        }
                    } else if let Err(error) = bootstrap::ensure_main_window(app) {
                        tracing::warn!(
                            error = %error,
                            "failed to open main window from tray menu"
                        );
                    }
                }
                "tray-toggle-background-mode" | "tray-stop-background-mode" => {
                    if let Some(state) = app.try_state::<AppState>() {
                        if is_background_mode_hidden(app, &state) {
                            stop_background_mode_and_show_window(app, &state);
                        } else {
                            start_background_mode_and_hide_window(app.clone());
                        }
                    }
                }
                "tray-disable-theme" => {
                    if let Some(state) = app.try_state::<AppState>() {
                        disable_community_theme_from_tray(app, &state);
                    }
                }
                "tray-exit" => {
                    commands::host::window::stop_runtime_services(app);
                    app.exit(0);
                }
                id if id.starts_with("mac-menu-") => {
                    #[cfg(target_os = "macos")]
                    if let Err(error) = macos_menu::emit_menu_action(app, id) {
                        tracing::warn!(error = %error, id, "failed to emit macOS menu action");
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::storage::storage__get,
            commands::storage::storage__set,
            commands::storage::storage__flush,
            commands::storage::storage__remove,
            commands::storage::storage__get_all,
            commands::database::sqlite__begin_upgrade,
            commands::database::sqlite__commit_upgrade,
            commands::database::sqlite__fail_upgrade,
            commands::database::sqlite__get_failed_upgrade,
            commands::web::web__clear_cookies,
            commands::web::web__get_cookies,
            commands::web::web__set_cookies,
            commands::host::error_log::app__append_error_log,
            commands::asset_bundle::asset_bundle__get_vrchat_cache_full_location,
            commands::asset_bundle::asset_bundle__check_vrchat_cache,
            commands::asset_bundle::asset_bundle__delete_cache,
            commands::asset_bundle::asset_bundle__delete_all_cache,
            commands::asset_bundle::asset_bundle__sweep_cache,
            commands::asset_bundle::asset_bundle__get_cache_size,
            commands::log_watcher::log_watcher__get,
            commands::log_watcher::log_watcher__get_current_location,
            commands::log_watcher::log_watcher__set_date_till,
            commands::log_watcher::log_watcher__reset,
            commands::log_watcher::log_watcher__vrc_closed_gracefully,
            commands::host::game::app__check_game_running,
            commands::host::game::app__is_game_running,
            commands::host::game::app__is_steamvr_running,
            commands::host::game::app__set_game_client_runtime_state,
            commands::host::game::app__quit_game,
            commands::host::game::app__start_game,
            commands::host::game::app__start_game_from_path,
            commands::application::realtime::app__start_realtime_transport,
            commands::application::realtime::app__sync_realtime_friend_snapshot,
            commands::application::realtime::app__sync_realtime_current_user_snapshot,
            commands::application::realtime::app__expire_realtime_notification,
            commands::application::realtime::app__stop_realtime_transport,
            commands::application::background_mode::app__start_background_mode,
            commands::application::background_mode::app__stop_background_mode,
            commands::application::background_mode::app__get_backend_runtime_snapshot,
            commands::application::background_mode::app__get_backend_runtime_frontend_session_snapshot,
            commands::application::background_mode::app__ensure_main_window,
            commands::application::overlay_activity::app__overlay_activity_definitions_get,
            commands::application::overlay_activity::app__overlay_activity_filters_reload,
            commands::application::overlay_activity::app__overlay_activity_snapshot_get,
            commands::application::vr_overlay::app__vr_overlay_status_get,
            commands::application::vr_overlay::app__vr_overlay_enabled_set,
            commands::application::vr_overlay::app__vr_overlay_config_reload,
            commands::application::registry_backup::app__registry_backup_list,
            commands::application::registry_backup::app__registry_backup_create,
            commands::application::registry_backup::app__registry_backup_restore,
            commands::application::registry_backup::app__registry_backup_delete,
            commands::application::registry_backup::app__registry_backup_export_json,
            commands::application::registry_backup::app__registry_backup_import_json,
            commands::application::registry_backup::app__registry_backup_maintenance_run,
            commands::local::config::app__config_set_values,
            commands::local::config::app__config_list_values,
            commands::local::config::app__config_remove_value,
            commands::local::database_maintenance::app__user_tables_ensure,
            commands::local::database_maintenance::app__database_maintenance_run,
            commands::local::database_maintenance::app__database_maintenance_table_sizes_get,
            commands::local::database_maintenance::app__database_maintenance_max_friend_log_number_get,
            commands::local::database_maintenance::app__database_maintenance_broken_leave_entries_get,
            commands::local::database_maintenance::app__database_maintenance_broken_game_log_display_names_get,
            commands::local::avatars::app__avatar_cache_upsert,
            commands::local::avatars::app__avatar_cache_get,
            commands::local::avatars::app__avatar_cache_list,
            commands::local::avatars::app__avatar_cache_remove,
            commands::local::avatars::app__avatar_history_add,
            commands::local::avatars::app__avatar_history_list,
            commands::local::avatars::app__avatar_time_spent_add,
            commands::local::avatars::app__avatar_time_spent_get,
            commands::local::avatars::app__avatar_time_spent_list,
            commands::local::avatars::app__avatar_history_clear,
            commands::local::avatars::app__avatar_tag_add,
            commands::local::avatars::app__avatar_tags_get,
            commands::local::avatars::app__avatar_tags_list,
            commands::local::avatars::app__avatar_tags_distinct,
            commands::local::avatars::app__avatar_tag_update_color,
            commands::local::avatars::app__avatar_tag_remove,
            commands::local::avatars::app__avatar_tags_remove_all,
            commands::local::avatars::app__avatar_tags_replace,
            commands::local::avatars::app__avatar_tags_patch,
            commands::local::feed::app__feed_add_entry,
            commands::local::feed::app__feed_avatar_purge,
            commands::local::feed::app__feed_live_rows_merge,
            commands::local::feed::app__feed_read_model_query,
            commands::local::feed::app__feed_rows_query,
            commands::local::game_log::app__game_log_entries_add,
            commands::local::game_log::app__game_log_instance_delete_by_location,
            commands::local::game_log::app__game_log_instance_delete,
            commands::local::game_log::app__game_log_entry_delete,
            commands::local::game_log::app__game_log_query,
            commands::local::player_list::app__player_list_location_get,
            commands::local::player_list::app__player_list_latest_location_get,
            commands::local::player_list::app__player_list_join_leave_rows,
            commands::local::player_list::app__instance_activity_dates_get,
            commands::local::player_list::app__instance_activity_rows_get,
            commands::local::player_list::app__world_summaries_get,
            commands::local::activity::app__activity_self_source_slice,
            commands::local::activity::app__activity_self_source_bounds,
            commands::local::activity::app__activity_self_source_after,
            commands::local::activity::app__activity_friend_presence_slice,
            commands::local::activity::app__activity_friend_presence_after,
            commands::local::activity::app__activity_self_sessions_refresh,
            commands::local::activity::app__activity_sync_state_get,
            commands::local::activity::app__activity_sync_state_upsert,
            commands::local::activity::app__activity_sessions_get,
            commands::local::activity::app__activity_sessions_replace,
            commands::local::activity::app__activity_sessions_append,
            commands::local::activity::app__activity_bucket_cache_get,
            commands::local::activity::app__activity_bucket_cache_upsert,
            commands::local::mutual_graph::app__mutual_graph_tables_ensure,
            commands::local::mutual_graph::app__mutual_graph_snapshot_get,
            commands::local::mutual_graph::app__mutual_graph_snapshot_save,
            commands::local::mutual_graph::app__mutual_graph_friend_update,
            commands::local::mutual_graph::app__mutual_graph_meta_upsert,
            commands::local::mutual_graph::app__mutual_graph_meta_bulk_upsert,
            commands::local::mutual_graph::app__mutual_graph_fetch_status_get,
            commands::local::mutual_graph::app__mutual_graph_fetch_cancel,
            commands::local::mutual_graph::app__mutual_graph_fetch_start,
            commands::local::worlds::app__world_cache_upsert,
            commands::local::worlds::app__world_cache_list,
            commands::local::worlds::app__world_cache_get,
            commands::local::worlds::app__world_cache_remove,
            commands::local::favorites::app__favorite_list,
            commands::local::favorites::app__favorite_add,
            commands::local::favorites::app__favorite_remove,
            commands::local::favorites::app__favorite_group_rename,
            commands::local::favorites::app__favorite_group_delete,
            commands::local::memos::app__memo_get_user,
            commands::local::memos::app__memo_list_users,
            commands::local::memos::app__memo_list_user_notes,
            commands::local::memos::app__memo_get_world,
            commands::local::memos::app__memo_get_avatar,
            commands::local::memos::app__memo_save_user,
            commands::local::memos::app__memo_save_world,
            commands::local::memos::app__memo_save_avatar,
            commands::local::friends::app__friend_log_current_list,
            commands::local::friends::app__friend_log_history_query,
            commands::local::friends::app__friend_log_replace_current,
            commands::local::friends::app__friend_log_delete_current_array,
            commands::local::friends::app__friend_log_upsert_current,
            commands::local::friends::app__friend_log_delete_current,
            commands::local::friends::app__friend_log_history_add,
            commands::local::friends::app__friend_log_history_delete,
            commands::local::notifications::app__notification_rows_query,
            commands::local::notifications::app__notification_list_query,
            commands::local::notifications::app__notification_add_v1,
            commands::local::notifications::app__notification_add_v2,
            commands::local::notifications::app__notification_v2_expire,
            commands::local::notifications::app__notification_v2_mark_seen,
            commands::local::notifications::app__notification_update_expired,
            commands::local::notifications::app__notification_delete,
            commands::local::notifications::app__notification_expire,
            commands::local::notifications::app__notification_mark_seen_local_bulk,
            commands::local::local_moderation::app__local_moderation_list,
            commands::local::local_moderation::app__local_moderation_get,
            commands::host::host_capabilities::app__get_host_capabilities,
            commands::host::paths::app__current_culture,
            commands::host::paths::app__current_language,
            commands::host::paths::app__get_app_data_dir_state,
            commands::host::paths::app__validate_app_data_dir,
            commands::host::paths::app__set_app_data_dir,
            commands::host::paths::app__clear_app_data_dir,
            commands::application::lifecycle::app__runtime_app_snapshot_get,
            commands::application::lifecycle::app__runtime_frontend_schedule_due_jobs_get,
            commands::application::lifecycle::app__runtime_frontend_schedule_job_due_claim,
            commands::application::lifecycle::app__runtime_frontend_schedule_job_defer,
            commands::application::lifecycle::app__runtime_frontend_schedule_schedules_reset,
            commands::application::lifecycle::app__runtime_group_instances_refresh,
            commands::application::lifecycle::app__runtime_background_job_record,
            commands::application::lifecycle::app__runtime_background_jobs_snapshot_get,
            commands::application::lifecycle::app__runtime_diagnostics_get,
            commands::application::lifecycle::app__runtime_lifecycle_snapshot_get,
            commands::application::lifecycle::app__runtime_sync_snapshot_get,
            commands::integrations::external_api::service::app__external_api_avatar_search_get,
            commands::integrations::external_api::service::app__external_api_github_releases_get,
            commands::integrations::external_api::service::app__external_api_image_data_url_get,
            commands::integrations::external_api::service::app__external_api_translation_request,
            commands::integrations::external_api::service::app__external_api_vrc_status_json_get,
            commands::integrations::external_api::service::app__external_api_youtube_video_metadata_get,
            commands::application::auth_scope::app__runtime_auth_scope_get,
            commands::application::auth_scope::app__runtime_auth_scope_set,
            commands::vrchat::auth::service::app__vrchat_auth_config_get,
            commands::vrchat::auth::service::app__vrchat_auth_cookie_session_restore,
            commands::vrchat::auth::service::app__vrchat_auth_current_user_get,
            commands::vrchat::auth::service::app__vrchat_auth_email_otp_verify,
            commands::vrchat::auth::service::app__vrchat_auth_file_analysis_get,
            commands::vrchat::auth::service::app__vrchat_auth_login_success_record,
            commands::vrchat::auth::service::app__vrchat_auth_login_basic,
            commands::vrchat::auth::service::app__vrchat_auth_login_basic_start,
            commands::vrchat::auth::service::app__vrchat_auth_logout_record,
            commands::vrchat::auth::service::app__vrchat_auth_otp_verify,
            commands::vrchat::auth::service::app__vrchat_auth_saved_credential_delete,
            commands::vrchat::auth::service::app__vrchat_auth_saved_credential_login_start,
            commands::vrchat::auth::service::app__vrchat_auth_saved_snapshot_get,
            commands::vrchat::auth::service::app__vrchat_auth_session_get,
            commands::vrchat::auth::service::app__vrchat_auth_totp_verify,
            commands::vrchat::auth::service::app__vrchat_auth_visits_get,
            commands::vrchat::avatars::service::app__vrchat_avatar_delete,
            commands::vrchat::avatars::service::app__vrchat_avatar_file_get,
            commands::vrchat::avatars::service::app__vrchat_avatar_gallery_get,
            commands::vrchat::avatars::service::app__vrchat_avatar_get,
            commands::vrchat::avatars::service::app__vrchat_avatar_impostor_create,
            commands::vrchat::avatars::service::app__vrchat_avatar_impostor_delete,
            commands::vrchat::avatars::service::app__vrchat_avatar_list_by_user_get,
            commands::vrchat::avatars::service::app__vrchat_avatar_moderation_delete,
            commands::vrchat::avatars::service::app__vrchat_avatar_moderations_get,
            commands::vrchat::avatars::service::app__vrchat_avatar_moderation_send,
            commands::vrchat::avatars::service::app__vrchat_avatar_save,
            commands::vrchat::avatars::service::app__vrchat_avatar_select,
            commands::vrchat::avatars::service::app__vrchat_avatar_select_fallback,
            commands::vrchat::avatars::service::app__vrchat_avatar_styles_get,
            commands::vrchat::favorites::service::app__vrchat_favorite_add,
            commands::vrchat::favorites::service::app__vrchat_favorite_avatars_get,
            commands::vrchat::favorites::service::app__vrchat_favorite_delete,
            commands::vrchat::favorites::service::app__vrchat_favorite_groups_get,
            commands::vrchat::favorites::service::app__vrchat_favorite_group_clear,
            commands::vrchat::favorites::service::app__vrchat_favorite_group_save,
            commands::vrchat::favorites::service::app__vrchat_favorite_limits_get,
            commands::vrchat::favorites::service::app__vrchat_favorite_worlds_get,
            commands::vrchat::favorites::service::app__vrchat_favorites_get,
            commands::vrchat::favorites::service::app__local_favorite_add,
            commands::vrchat::favorites::service::app__local_favorite_group_create,
            commands::vrchat::favorites::service::app__local_favorite_group_delete,
            commands::vrchat::favorites::service::app__local_favorite_group_rename,
            commands::vrchat::favorites::service::app__local_favorite_remove,
            commands::vrchat::friends::service::app__vrchat_friend_status_get,
            commands::vrchat::friends::service::app__vrchat_friend_delete,
            commands::vrchat::friends::service::app__vrchat_friend_request_cancel,
            commands::vrchat::friends::service::app__vrchat_friend_request_send,
            commands::vrchat::friends::service::app__vrchat_friends_get,
            commands::vrchat::groups::service::app__vrchat_group_audit_log_types_get,
            commands::vrchat::groups::service::app__vrchat_group_bans_get,
            commands::vrchat::groups::service::app__vrchat_group_block,
            commands::vrchat::groups::service::app__vrchat_group_gallery_get,
            commands::vrchat::groups::service::app__vrchat_group_get,
            commands::vrchat::groups::service::app__vrchat_group_instances_get,
            commands::vrchat::groups::service::app__vrchat_group_invite_delete,
            commands::vrchat::groups::service::app__vrchat_group_invite_send,
            commands::vrchat::groups::service::app__vrchat_group_invites_get,
            commands::vrchat::groups::service::app__vrchat_group_join,
            commands::vrchat::groups::service::app__vrchat_group_join_requests_get,
            commands::vrchat::groups::service::app__vrchat_group_join_request_respond,
            commands::vrchat::groups::service::app__vrchat_group_leave,
            commands::vrchat::groups::service::app__vrchat_group_logs_get,
            commands::vrchat::groups::service::app__vrchat_group_member_ban,
            commands::vrchat::groups::service::app__vrchat_group_member_kick,
            commands::vrchat::groups::service::app__vrchat_group_member_props_set,
            commands::vrchat::groups::service::app__vrchat_group_member_unban,
            commands::vrchat::groups::service::app__vrchat_group_members_get,
            commands::vrchat::groups::service::app__vrchat_group_members_search,
            commands::vrchat::groups::service::app__vrchat_group_post_create,
            commands::vrchat::groups::service::app__vrchat_group_post_delete,
            commands::vrchat::groups::service::app__vrchat_group_post_edit,
            commands::vrchat::groups::service::app__vrchat_group_posts_get,
            commands::vrchat::groups::service::app__vrchat_group_representation_set,
            commands::vrchat::groups::service::app__vrchat_group_request_cancel,
            commands::vrchat::groups::service::app__vrchat_group_unblock,
            commands::vrchat::groups::service::app__vrchat_group_user_groups_get,
            commands::vrchat::groups::service::app__vrchat_group_user_instances_get,
            commands::vrchat::instances::service::app__vrchat_instance_close,
            commands::vrchat::instances::service::app__vrchat_instance_create,
            commands::vrchat::instances::service::app__vrchat_instance_get,
            commands::vrchat::instances::service::app__vrchat_instance_self_invite,
            commands::vrchat::instances::service::app__vrchat_instance_short_name_get,
            commands::vrchat::media::service::app__vrchat_media_avatar_gallery_image_upload,
            commands::vrchat::media::service::app__vrchat_media_avatar_image_set,
            commands::vrchat::media::service::app__vrchat_media_avatar_image_upload_legacy,
            commands::vrchat::media::service::app__vrchat_media_asset_upload,
            commands::vrchat::media::service::app__vrchat_media_emoji_upload,
            commands::vrchat::media::service::app__vrchat_media_file_delete,
            commands::vrchat::media::service::app__vrchat_media_file_put,
            commands::vrchat::media::service::app__vrchat_media_file_upload_finish,
            commands::vrchat::media::service::app__vrchat_media_file_upload_start,
            commands::vrchat::media::service::app__vrchat_media_file_version_create,
            commands::vrchat::media::service::app__vrchat_media_files_get,
            commands::vrchat::media::service::app__vrchat_media_gallery_image_upload,
            commands::vrchat::media::service::app__vrchat_media_inventory_bundle_consume,
            commands::vrchat::media::service::app__vrchat_media_inventory_item_update,
            commands::vrchat::media::service::app__vrchat_media_inventory_items_get,
            commands::vrchat::media::service::app__vrchat_media_print_delete,
            commands::vrchat::media::service::app__vrchat_media_print_get,
            commands::vrchat::media::service::app__vrchat_media_print_upload,
            commands::vrchat::media::service::app__vrchat_media_prints_get,
            commands::vrchat::media::service::app__vrchat_media_reward_redeem,
            commands::vrchat::media::service::app__vrchat_media_sticker_upload,
            commands::vrchat::media::service::app__vrchat_media_user_inventory_item_get,
            commands::vrchat::media::service::app__vrchat_media_vrc_plus_icon_upload,
            commands::vrchat::media::service::app__vrchat_media_world_image_set,
            commands::vrchat::media::service::app__vrchat_media_world_image_upload_legacy,
            commands::application::moderation_sync::app__moderation_sync_refresh,
            commands::application::moderation_sync::app__moderation_sync_update,
            commands::vrchat::notifications::service::app__vrchat_boop_send,
            commands::vrchat::notifications::service::app__vrchat_invite_photo_send,
            commands::vrchat::notifications::service::app__vrchat_invite_response_photo_send,
            commands::vrchat::notifications::service::app__vrchat_invite_response_send,
            commands::vrchat::notifications::service::app__vrchat_invite_send,
            commands::vrchat::notifications::service::app__vrchat_notification_accept_friend_request,
            commands::vrchat::notifications::service::app__vrchat_notification_hide_remote,
            commands::vrchat::notifications::service::app__vrchat_notification_mark_seen,
            commands::vrchat::notifications::service::app__vrchat_notification_respond,
            commands::vrchat::notifications::service::app__vrchat_request_invite_photo_send,
            commands::vrchat::notifications::service::app__vrchat_request_invite_send,
            commands::vrchat::search::service::app__vrchat_search_config_get,
            commands::vrchat::search::service::app__vrchat_search_groups_get,
            commands::vrchat::search::service::app__vrchat_search_groups_strict_get,
            commands::vrchat::search::service::app__vrchat_search_instance_short_name_get,
            commands::vrchat::search::service::app__vrchat_search_users_get,
            commands::vrchat::search::service::app__vrchat_search_worlds_get,
            commands::application::social_baseline::service::app__social_favorites_baseline_get,
            commands::application::social_baseline::service::app__social_friend_roster_baseline_get,
            commands::vrchat::tools::service::app__vrchat_tools_calendars_get,
            commands::vrchat::tools::service::app__vrchat_tools_featured_calendars_get,
            commands::vrchat::tools::service::app__vrchat_tools_following_calendars_get,
            commands::vrchat::tools::service::app__vrchat_tools_group_calendar_get,
            commands::vrchat::tools::service::app__vrchat_tools_group_calendar_ics_get,
            commands::vrchat::tools::service::app__vrchat_tools_group_event_follow,
            commands::vrchat::tools::service::app__vrchat_tools_invite_message_edit,
            commands::vrchat::tools::service::app__vrchat_tools_invite_messages_get,
            commands::vrchat::tools::service::app__vrchat_tools_user_note_save,
            commands::vrchat::tools::service::app__vrchat_tools_user_report,
            commands::vrchat::users::service::app__vrchat_current_user_badge_update,
            commands::vrchat::users::service::app__vrchat_current_user_tags_add,
            commands::vrchat::users::service::app__vrchat_current_user_tags_remove,
            commands::vrchat::users::service::app__vrchat_current_user_update,
            commands::vrchat::users::service::app__vrchat_user_get,
            commands::vrchat::users::service::app__vrchat_user_groups_get,
            commands::vrchat::users::service::app__vrchat_user_mutual_counts_get,
            commands::vrchat::users::service::app__vrchat_user_mutual_friends_get,
            commands::vrchat::users::service::app__vrchat_user_represented_group_get,
            commands::vrchat::worlds::service::app__vrchat_world_delete,
            commands::vrchat::worlds::service::app__vrchat_world_get,
            commands::vrchat::worlds::service::app__vrchat_world_list_by_user_get,
            commands::vrchat::worlds::service::app__vrchat_world_persistent_data_delete,
            commands::vrchat::worlds::service::app__vrchat_world_persistent_data_exists,
            commands::vrchat::worlds::service::app__vrchat_world_publish,
            commands::vrchat::worlds::service::app__vrchat_world_save,
            commands::vrchat::worlds::service::app__vrchat_world_unpublish,
            commands::host::window::app__set_user_agent,
            commands::host::shell::app__open_link,
            commands::host::shell::app__open_discord_profile,
            commands::discord::discord__set_active,
            commands::discord::discord__set_assets,
            commands::host::shell::app__get_file_base64,
            commands::host::shell::app__get_file_bytes,
            commands::host::shell::app__read_config_file,
            commands::host::shell::app__read_config_file_safe,
            commands::host::shell::app__write_config_file,
            commands::host::paths::app__get_vrchat_app_data_location,
            commands::host::paths::app__get_vrchat_photos_location,
            commands::host::paths::app__get_ugc_photo_location,
            commands::host::paths::app__get_vrchat_cache_location,
            commands::host::paths::app__get_vrchat_screenshots_location,
            commands::host::vrchat_log::app__vrchat_log_files_list,
            commands::host::vrchat_log::app__vrchat_log_entries_read,
            commands::host::vrchat_log::app__vrchat_log_tail_read,
            commands::host::shell::app__open_vrcx_app_data_folder,
            commands::host::shell::app__open_vrc_app_data_folder,
            commands::host::shell::app__open_vrc_photos_folder,
            commands::host::shell::app__open_ugc_photos_folder,
            commands::host::shell::app__open_vrc_screenshots_folder,
            commands::host::shell::app__open_crash_vrc_crash_dumps,
            commands::host::shell::app__open_folder_and_select_item,
            commands::host::shell::app__background_image_files_resolve,
            commands::host::shell::app__open_background_image_files_selector_dialog,
            commands::host::shell::app__open_file_selector_dialog,
            commands::host::shell::app__open_folder_selector_dialog,
            commands::host::shell::app__save_vrc_reg_json_file,
            commands::host::theme_debug::app__community_theme_debug_load_local_theme,
            commands::host::window::app__focus_window,
            commands::host::window::app__flash_window,
            commands::host::window::app__change_theme,
            commands::host::window::app__do_funny,
            commands::host::window::app__set_tray_icon_notification,
            commands::host::window::app__refresh_tray_menu,
            commands::host::window::app__open_devtools,
            commands::host::window::app__restart_application,
            commands::host::window::app__exit_application,
            commands::host::updater::app__check_tauri_update,
            commands::host::updater::app__download_and_install_tauri_update,
            commands::host::legacy_migration::app__check_legacy_vrcx_available,
            commands::host::legacy_migration::app__get_legacy_vrcx_force_migration_status,
            commands::host::legacy_migration::app__get_legacy_vrcx_migration_status,
            commands::host::legacy_migration::app__request_legacy_migration,
            commands::host::legacy_migration::app__request_legacy_vrcx_force_migration,
            commands::host::clipboard::app__get_clipboard,
            commands::host::clipboard::app__copy_image_to_clipboard,
            commands::host::window::app__set_startup,
            commands::host::registry::app__get_vrchat_registry_key,
            commands::host::registry::app__get_vrchat_registry_key_string,
            commands::host::registry::app__has_vrchat_registry_folder,
            commands::host::registry::app__delete_vrchat_registry_folder,
            commands::host::registry::app__set_vrchat_registry_key,
            commands::host::registry::app__get_vrchat_registry,
            commands::host::registry::app__set_vrchat_registry,
            commands::host::registry::app__read_vrc_reg_json_file,
            commands::host::window::app__desktop_notification,
            commands::host::overlay_notifications::app__xs_notification,
            commands::host::overlay_notifications::app__ovrt_notification,
            commands::host::window::app__auth_failure_notification_show,
            commands::local::local_player_moderations::app__get_vrchat_moderations,
            commands::local::local_player_moderations::app__get_vrchat_user_moderation,
            commands::local::local_player_moderations::app__set_vrchat_user_moderation,
            commands::host::ipc_commands::app__ipc_announce_start,
            commands::host::ipc_commands::app__send_ipc,
            commands::host::ipc_commands::app__try_open_instance_in_vrc,
            commands::host::app_launcher::app__app_launcher_snapshot_get,
            commands::host::app_launcher::app__app_launcher_enabled_set,
            commands::host::app_launcher::app__app_launcher_entries_set,
            commands::host::app_launcher::app__app_launcher_entry_test,
            commands::host::app_launcher::app__app_launcher_test_run_stop,
            commands::host::app_launcher::app__app_launcher_target_pick,
            commands::host::calendar::app__open_calendar_file,
            commands::host::calendar::app__save_calendar_file,
            commands::host::media::app__save_image_file,
            commands::host::media::app__get_image,
            commands::host::media::app__resize_image_to_fit_limits,
            commands::host::media::app__sign_file,
            commands::host::screenshots::app__get_extra_screenshot_data,
            commands::host::screenshots::app__get_screenshot_metadata,
            commands::host::screenshots::app__find_screenshots_by_search,
            commands::host::screenshots::app__start_screenshot_library_scan,
            commands::host::screenshots::app__get_screenshot_library_status,
            commands::host::screenshots::app__get_screenshot_folder_tree,
            commands::host::screenshots::app__get_screenshot_folder_images,
            commands::host::screenshots::app__get_world_screenshots,
            commands::host::screenshots::app__ensure_screenshot_thumbnail,
            commands::host::screenshots::app__get_last_screenshot,
            commands::host::screenshots::app__delete_screenshot_metadata,
            commands::host::screenshots::app__delete_all_screenshot_metadata,
            commands::host::screenshots::app__add_screenshot_metadata,
            commands::host::media::app__crop_all_prints,
            commands::host::media::app__crop_print_image,
            commands::host::media::app__save_print_to_file,
            commands::host::media::app__save_sticker_to_file,
            commands::host::media::app__save_emoji_to_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_some() {
                    return;
                }
                let Some(state) = app.try_state::<AppState>() else {
                    return;
                };
                let snapshot = state.snapshot_backend_runtime();
                if snapshot.mode == BackendRuntimeMode::Background
                    && snapshot.phase == BackendRuntimePhase::Running
                {
                    api.prevent_exit();
                }
            }
        });
}
