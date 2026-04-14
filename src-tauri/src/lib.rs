mod api;
mod domain;
mod error;
mod state;

use std::collections::HashMap;
use std::borrow::Cow;
use std::time::Duration;

use tauri::http::{header::CONTENT_TYPE, Request, Response, StatusCode};
use tauri::menu::{Menu, MenuItem};
use tauri::Manager;
use tauri::WindowEvent;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri_plugin_autostart::ManagerExt as _;

use state::AppState;

fn db_config_bool(state: &AppState, key: &str) -> Option<bool> {
    let mut args = HashMap::new();
    args.insert("@key".to_string(), serde_json::Value::String(key.to_string()));

    state
        .db
        .execute("SELECT value FROM configs WHERE key = @key LIMIT 1", &args)
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .and_then(|row| row.into_iter().next())
        .and_then(|value| value.as_str().map(|s| s == "true"))
}

fn screenshot_protocol_response(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = match percent_encoding::percent_decode_str(&request.uri().path()[1..])
        .decode_utf8()
    {
        Ok(path) => path.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Vec::new().into())
                .unwrap();
        }
    };

    let path_buf = std::path::PathBuf::from(&path);
    let is_png = path_buf
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"));

    if !is_png || !path_buf.is_file() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    match std::fs::read(&path_buf) {
        Ok(bytes) => Response::builder()
            .header(CONTENT_TYPE, "image/png")
            .body(bytes.into())
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new().into())
            .unwrap(),
    }
}

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
        .register_asynchronous_uri_scheme_protocol(
            "vrcx-img",
            |_ctx, request, responder| {
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(screenshot_protocol_response(request));
                });
            },
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
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
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_skip_taskbar(false);
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        })
        .manage(app_state)
        .setup(|app| {
            let state = app.state::<AppState>();
            if let Some(tray) = app.tray_by_id("main") {
                let exit_item = MenuItem::with_id(app, "tray-exit", "Exit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&exit_item])?;
                let _ = tray.set_menu(Some(menu));
                let _ = tray.set_show_menu_on_left_click(false);
            }

            if db_config_bool(&state, "config:vrcx_startatwindowsstartup") == Some(true)
                && !app.autolaunch().is_enabled().unwrap_or(false)
            {
                let _ = app.autolaunch().enable();
            }

            if state.launched_from_autostart
                && state.storage.get("VRCX_StartAsMinimizedState").as_deref() == Some("true")
            {
                if let Some(window) = app.get_webview_window("main") {
                    let window = window.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        let _ = window.hide();
                        let _ = window.set_skip_taskbar(true);
                    });
                }
            }
            state
                .process_monitor
                .start(
                    app.handle().clone(),
                    state.auto_launch.clone(),
                    state.log_watcher.clone(),
                );
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
            api::discord::discord__set_active,
            api::discord::discord__set_assets,
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
            api::app::app__save_vrc_reg_json_file,
            api::app::app__focus_window,
            api::app::app__flash_window,
            api::app::app__show_dev_tools,
            api::app::app__change_theme,
            api::app::app__do_funny,
            api::app::app__set_tray_icon_notification,
            api::app::app__restart_application,
            api::app::app__check_for_update_exe,
            api::app::app__check_legacy_vrcx_available,
            api::app::app__request_legacy_migration,
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
