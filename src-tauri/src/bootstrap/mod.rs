mod adapters;
mod autostart;
mod background_delay;
mod notification;
mod protocol;
mod setup;
mod shared;
mod window;

pub use adapters::emit_to_main_window_if_visible;
pub(crate) use background_delay::{arm_background_delay, cancel_background_delay};
pub(crate) use notification::{
    show_auth_failure_notification_after_backend_start_error, show_auth_failure_notification_once,
    show_background_mode_started_notification,
};
pub use protocol::{
    background_image_protocol_response, screenshot_protocol_response,
    screenshot_thumbnail_protocol_response,
};
pub use setup::{
    app_update_build_badge, app_update_build_label, apply_linux_webkit_workaround,
    init_error_logging, init_tls_crypto_provider, setup_app_with_data_dir, updater_public_key,
};
pub(crate) use window::rebuild_main_window;
pub use window::{
    capture_background_resume_route, destroy_main_window_for_background_mode, ensure_main_window,
    refresh_tray_menu, restore_foreground_window_from_background_mode,
    start_background_mode_for_current_session,
};
