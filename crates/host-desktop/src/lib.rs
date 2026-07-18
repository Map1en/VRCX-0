pub mod asset_bundle_cache;
pub mod auto_launch;
pub mod calendar;
pub mod clipboard;
pub mod discord_rpc;
pub mod game_launch;
pub mod host_capabilities;
#[cfg(target_os = "linux")]
pub mod linux_registry;
pub mod local_player_moderations;
pub mod log_scanner;
#[cfg(any(windows, target_os = "linux"))]
pub mod overlay_notifications;
pub mod process_status;
pub mod shell_actions;
pub mod system_fonts;
pub mod system_theme;
pub mod tts;
pub mod updater_policy;
#[cfg(any(windows, target_os = "linux"))]
pub mod vr_overlay;
pub mod vrchat_ipc;
pub mod vrchat_paths;
pub mod vrchat_registry;
