mod ancillary_snapshot;
mod app_launcher;
mod assistant_adapters;
pub mod auth_failure;
mod autostart;
mod avatar;
mod background_image;
mod background_remote;
mod context;
mod current_user_mutation;
pub mod data_dir;
mod database_upgrade;
pub mod deep_link;
pub mod desktop_widget;
mod external_api;
pub mod feed_logger;
mod game_client;
mod game_isolation;
mod game_log;
mod game_log_import;
mod game_media;
mod game_state_store;
mod group;
mod group_order;
mod host_actions;
mod host_file_access;
mod instance_launch;
mod integration_api;
pub mod legacy_migration;
pub mod local_data;
mod log_watcher;
mod mcp_adapters;
mod media;
pub mod notification;
mod privacy_lock;
mod process_monitor;
mod profile_backup;
mod profile_bio;
mod proxy_connectivity;
mod registry_backup;
mod screenshot;
pub mod sidebar_auto_hide;
pub mod single_instance;
mod social;
mod startup_bootstrap;
mod state;
pub mod tray_shortcut;
pub mod vr_overlay;
pub mod vrchat_api;
mod vrchat_remote;
mod world_remote;

pub use ancillary_snapshot::AncillaryRuntimeSnapshot;
pub use app_launcher::AppLauncherSnapshotEvent;
pub use autostart::{set_autostart_preference, AutostartPlatform};
pub use avatar::DesktopAvatarRuntime;
pub use background_image::{
    background_image_files_from_paths, HostBackgroundImageFileResolver, BACKGROUND_IMAGE_EXTENSIONS,
};
pub use context::DesktopRuntimeServices;
pub use database_upgrade::{DatabaseUpgradeLifecycle, DesktopDatabaseUpgradeRuntime};
pub use external_api::{ExternalApiExecuteResponse, ExternalApiRuntime};
pub use game_client::{GameClientHostRuntime, GameClientHostRuntimeDeps};
pub use game_isolation::{GameIsolationRuntime, GameIsolationSnapshot};
pub use game_log::{GameLogHostRuntime, GameLogHostRuntimeDeps};
pub use group::DesktopGroupRuntime;
pub use host_actions::{RuntimeHost, RuntimeHostActions};
pub use host_file_access::{ensure_vrchat_launch_path_allowed, is_known_root_path, HostFileAccess};
pub use integration_api::DesktopIntegrationApiRuntime;
pub use legacy_migration::{
    DesktopLegacyMigrationRuntime, LegacyMigrationLifecycle, LegacyMigrationRequestMode,
};
pub use log_watcher::{
    GameLogEvent, GameLogEventOrigin, GameLogEventSink, HostInstanceRosterFanout,
    HostLogLocationSnapshotScanner, LogLocationSnapshot, LogWatcher,
};
pub use media::DesktopMediaRuntime;
pub use privacy_lock::{
    PrivacyLockDeviceStart, PrivacyLockOutcome, PrivacyLockRuntime, PrivacyLockSnapshot,
};
pub use process_monitor::HostGameProcessMonitorActions;
pub use profile_backup::{
    DesktopProfileBackupRuntime, DesktopProfileRestoreRequest, ProfileBackupSettingsError,
};
pub use proxy_connectivity::test_proxy_connectivity;
pub use registry_backup::HostRegistryBackupActions;
pub use screenshot::DesktopScreenshotRuntime;
pub use social::DesktopSocialRuntime;
pub use startup_bootstrap::{system_culture, system_language, StartupBootstrapSnapshot};
pub use state::{
    CurrentUserRefreshOutcome, DesktopRuntimeBundle, DesktopRuntimeHostOptions,
    DesktopRuntimeHostState, GameRuntimeBundle, RuntimeJobRecordInput,
};
pub use vrchat_remote::DesktopVrchatRemoteFacade;
pub use vrcx_0_composition::{Error, Result};
