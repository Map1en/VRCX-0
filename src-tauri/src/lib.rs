mod api;
mod bootstrap;
mod domain;
mod error;
mod state;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::Manager;
use tauri::WindowEvent;

use state::AppState;

pub fn run() {
    bootstrap::init_error_logging();
    bootstrap::apply_linux_webkit_workaround();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            bootstrap::show_main_window(app);
        }))
        .register_asynchronous_uri_scheme_protocol("vrcx-img", |_ctx, request, responder| {
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(bootstrap::screenshot_protocol_response(request));
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
                if state.storage.get("VRCX_CloseToTray").as_deref() == Some("true") {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.set_skip_taskbar(true);
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
                bootstrap::show_main_window(app);
            }
            _ => {}
        })
        .setup(bootstrap::setup_app)
        .on_menu_event(|app, event| {
            if event.id().0 == "tray-exit" {
                app.exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            api::storage::storage__get,
            api::storage::storage__set,
            api::storage::storage__flush,
            api::storage::storage__remove,
            api::storage::storage__get_all,
            api::database::sqlite__execute,
            api::database::sqlite__execute_on_writer,
            api::database::sqlite__execute_non_query,
            api::database::sqlite__begin_upgrade,
            api::database::sqlite__commit_upgrade,
            api::database::sqlite__fail_upgrade,
            api::database::sqlite__get_failed_upgrade,
            api::web::web__clear_cookies,
            api::web::web__get_cookies,
            api::web::web__set_cookies,
            api::web::web__execute,
            api::app::error_log::app__append_error_log,
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
            api::app::game::app__check_game_running,
            api::app::game::app__is_game_running,
            api::app::game::app__is_steamvr_running,
            api::app::game::app__quit_game,
            api::app::game::app__start_game,
            api::app::game::app__start_game_from_path,
            api::app::host_capabilities::app__get_host_capabilities,
            api::app::paths::app__current_culture,
            api::app::paths::app__current_language,
            api::app::window::app__set_user_agent,
            api::app::shell::app__open_link,
            api::app::shell::app__open_discord_profile,
            api::discord::discord__set_active,
            api::discord::discord__set_assets,
            api::app::shell::app__get_file_base64,
            api::app::shell::app__get_file_bytes,
            api::app::shell::app__read_config_file,
            api::app::shell::app__read_config_file_safe,
            api::app::shell::app__write_config_file,
            api::app::paths::app__get_vrchat_app_data_location,
            api::app::paths::app__get_vrchat_photos_location,
            api::app::paths::app__get_ugc_photo_location,
            api::app::paths::app__get_vrchat_cache_location,
            api::app::paths::app__get_vrchat_screenshots_location,
            api::app::shell::app__open_vrcx_app_data_folder,
            api::app::shell::app__open_vrc_app_data_folder,
            api::app::shell::app__open_vrc_photos_folder,
            api::app::shell::app__open_ugc_photos_folder,
            api::app::shell::app__open_vrc_screenshots_folder,
            api::app::shell::app__open_crash_vrc_crash_dumps,
            api::app::shell::app__open_shortcut_folder,
            api::app::shell::app__open_folder_and_select_item,
            api::app::shell::app__open_file_selector_dialog,
            api::app::shell::app__open_folder_selector_dialog,
            api::app::shell::app__save_vrc_reg_json_file,
            api::app::window::app__focus_window,
            api::app::window::app__flash_window,
            api::app::window::app__change_theme,
            api::app::window::app__do_funny,
            api::app::window::app__set_tray_icon_notification,
            api::app::window::app__restart_application,
            api::app::legacy_migration::app__check_legacy_vrcx_available,
            api::app::legacy_migration::app__get_legacy_vrcx_migration_status,
            api::app::legacy_migration::app__request_legacy_migration,
            api::app::clipboard::app__get_clipboard,
            api::app::clipboard::app__copy_image_to_clipboard,
            api::app::window::app__set_startup,
            api::app::registry::app__get_vrchat_registry_key,
            api::app::registry::app__get_vrchat_registry_key_string,
            api::app::registry::app__has_vrchat_registry_folder,
            api::app::registry::app__delete_vrchat_registry_folder,
            api::app::registry::app__set_vrchat_registry_key,
            api::app::registry::app__get_vrchat_registry,
            api::app::registry::app__set_vrchat_registry,
            api::app::registry::app__read_vrc_reg_json_file,
            api::app::window::app__desktop_notification,
            api::app::moderation::app__get_vrchat_moderations,
            api::app::moderation::app__get_vrchat_user_moderation,
            api::app::moderation::app__set_vrchat_user_moderation,
            api::app::ipc_commands::app__ipc_announce_start,
            api::app::ipc_commands::app__send_ipc,
            api::app::ipc_commands::app__set_app_launcher_settings,
            api::app::ipc_commands::app__try_open_instance_in_vrc,
            api::app::calendar::app__open_calendar_file,
            api::app::calendar::app__save_calendar_file,
            api::app::media::app__save_image_file,
            api::app::media::app__get_image,
            api::app::media::app__resize_image_to_fit_limits,
            api::app::media::app__sign_file,
            api::app::screenshots::app__get_extra_screenshot_data,
            api::app::screenshots::app__get_screenshot_metadata,
            api::app::screenshots::app__find_screenshots_by_search,
            api::app::screenshots::app__get_last_screenshot,
            api::app::screenshots::app__delete_screenshot_metadata,
            api::app::screenshots::app__delete_all_screenshot_metadata,
            api::app::screenshots::app__add_screenshot_metadata,
            api::app::media::app__crop_all_prints,
            api::app::media::app__crop_print_image,
            api::app::media::app__save_print_to_file,
            api::app::media::app__save_sticker_to_file,
            api::app::media::app__save_emoji_to_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
