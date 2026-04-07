mod api;
mod domain;
mod error;
mod state;

use tauri::Manager;

use state::AppState;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vrcx_0=info".into()),
        )
        .init();

    let app_state = AppState::new().expect("failed to initialize app state");

    app_state.update_manager.check_and_install_update();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(app_state)
        .setup(|app| {
            let state = app.state::<AppState>();
            state
                .process_monitor
                .start(app.handle().clone(), state.auto_launch.clone());
            state.ipc.start(app.handle().clone());

            let local_low = std::env::var("LOCALAPPDATA")
                .map(|p| std::path::PathBuf::from(p).join("..\\LocalLow\\VRChat\\VRChat"))
                .unwrap_or_default();
            state.log_watcher.start(local_low, app.handle().clone());

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::storage::storage__get,
            api::storage::storage__set,
            api::storage::storage__flush,
            api::storage::storage__remove,
            api::storage::storage__get_all,
            api::database::sqlite__execute,
            api::database::sqlite__execute_non_query,
            api::web::web__clear_cookies,
            api::web::web__get_cookies,
            api::web::web__set_cookies,
            api::web::web__execute,
            api::asset_bundle::asset_bundle__get_vrchat_cache_full_location,
            api::asset_bundle::asset_bundle__check_vrchat_cache,
            api::asset_bundle::asset_bundle__delete_cache,
            api::asset_bundle::asset_bundle__delete_all_cache,
            api::asset_bundle::asset_bundle__sweep_cache,
            api::asset_bundle::asset_bundle__get_cache_size,
            api::log_watcher::log_watcher__get,
            api::log_watcher::log_watcher__set_date_till,
            api::log_watcher::log_watcher__reset,
            api::log_watcher::log_watcher__vrc_closed_gracefully,
            api::app::app__check_game_running,
            api::app::app__is_game_running,
            api::app::app__is_steamvr_running,
            api::app::app__quit_game,
            api::app::app__start_game,
            api::app::app__start_game_from_path,
            api::app::app__current_culture,
            api::app::app__current_language,
            api::app::app__set_user_agent,
            api::app::app__open_link,
            api::app::app__open_discord_profile,
            api::app::app__get_file_base64,
            api::app::app__get_file_bytes,
            api::app::app__read_config_file,
            api::app::app__read_config_file_safe,
            api::app::app__write_config_file,
            api::app::app__get_vrchat_app_data_location,
            api::app::app__get_vrchat_photos_location,
            api::app::app__get_ugc_photo_location,
            api::app::app__get_vrchat_cache_location,
            api::app::app__get_vrchat_screenshots_location,
            api::app::app__open_vrcx_app_data_folder,
            api::app::app__open_vrc_app_data_folder,
            api::app::app__open_vrc_photos_folder,
            api::app::app__open_ugc_photos_folder,
            api::app::app__open_vrc_screenshots_folder,
            api::app::app__open_crash_vrc_crash_dumps,
            api::app::app__open_shortcut_folder,
            api::app::app__open_folder_and_select_item,
            api::app::app__open_file_selector_dialog,
            api::app::app__open_folder_selector_dialog,
            api::app::app__focus_window,
            api::app::app__flash_window,
            api::app::app__show_dev_tools,
            api::app::app__change_theme,
            api::app::app__do_funny,
            api::app::app__set_tray_icon_notification,
            api::app::app__restart_application,
            api::app::app__check_for_update_exe,
            api::app::app__get_clipboard,
            api::app::app__copy_image_to_clipboard,
            api::app::app__set_startup,
            api::app::app__get_vrchat_registry_key,
            api::app::app__get_vrchat_registry_key_string,
            api::app::app__has_vrchat_registry_folder,
            api::app::app__delete_vrchat_registry_folder,
            api::app::app__set_vrchat_registry_key,
            api::app::app__get_vrchat_registry,
            api::app::app__set_vrchat_registry,
            api::app::app__read_vrc_reg_json_file,
            api::app::app__desktop_notification,
            api::app::app__xs_notification,
            api::app::app__ovrt_notification,
            api::app::app__get_vrchat_moderations,
            api::app::app__get_vrchat_user_moderation,
            api::app::app__set_vrchat_user_moderation,
            api::app::app__ipc_announce_start,
            api::app::app__send_ipc,
            api::app::app__set_app_launcher_settings,
            api::app::app__try_open_instance_in_vrc,
            api::app::app__open_calendar_file,
            api::app::app__populate_image_hosts,
            api::app::app__get_image,
            api::app::app__resize_image_to_fit_limits,
            api::app::app__sign_file,
            api::app::app__get_extra_screenshot_data,
            api::app::app__get_screenshot_metadata,
            api::app::app__find_screenshots_by_search,
            api::app::app__get_last_screenshot,
            api::app::app__delete_screenshot_metadata,
            api::app::app__delete_all_screenshot_metadata,
            api::app::app__add_screenshot_metadata,
            api::app::app__crop_all_prints,
            api::app::app__crop_print_image,
            api::app::app__save_print_to_file,
            api::app::app__save_sticker_to_file,
            api::app::app__save_emoji_to_file,
            api::app::app__download_update,
            api::app::app__cancel_update,
            api::app::app__check_update_progress,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
