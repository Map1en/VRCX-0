use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::path::Path;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    telemetry::{TelemetryRuntime, TelemetryRuntimeDeps},
    vr_overlay::{
        start_preview_bridge_if_enabled, VrOverlayActivitySink, VrOverlayRuntime,
        VrOverlayRuntimeSnapshot, VR_OVERLAY_ENABLED_CONFIG_KEY,
    },
    GameClientHostRuntime, GameLogEventSink, GameLogHostRuntime, HostFileAccess,
    HostGameLogEventFanout, HostLogLocationSnapshotScanner, HostRegistryBackupActions, LogWatcher,
    Result, RuntimeHostContext, RuntimeHostEventSink,
};
use vrcx_0_application::{
    apply_friend_roster_baseline_sync_outcome, auth_response_error_message,
    build_background_discord_presence_command, build_background_presence_facts,
    build_favorites_baseline, build_friend_roster_baseline, build_friend_roster_baseline_deferred,
    current_user_from_cookie, parse_current_user_response, probe_current_user_from_cookie,
    record_login_success, record_logout, refresh_background_current_user,
    refresh_background_group_instances, refresh_player_moderations,
    run_background_presence_automation, saved_credential_login_start, saved_snapshot,
    AuthenticatedRuntimeSession, BackendRuntime, BackendRuntimeMode, BackendRuntimePhase,
    BackendRuntimeSnapshot, BackendRuntimeTelemetry, BackgroundCapabilitySession,
    BackgroundDiscordPresenceCommand, BackgroundDiscordPresenceState,
    BackgroundPresenceAutomationState, BackgroundPresenceFactsInput, CookieSessionProbe,
    FriendProjection, GameProcessEvent, GameProcessEventSink, ImageCache, LoginSuccessRecordInput,
    LogoutRecordInput, ModerationSyncDeps, ModerationSyncRefreshInput, NonInteractiveAuthError,
    OverlayActivitySnapshot, OverlayFavoriteGroups, PrintCleanupDeps, PrintCleanupTrigger,
    ProcessMonitor, ProfileBackupRuntime, RealtimeHostRuntime, RealtimeHostRuntimeDeps,
    RealtimeStopRequest, RegistryBackupMaintenanceMode, RegistryBackupMaintenanceResult,
    RegistryBackupSnapshot, RuntimeBackgroundJobs, RuntimeEventSink,
    SavedCredentialLoginStartInput, SessionHostRuntime, SocialBaselineDeps,
    SocialFavoritesBaselineInput, SocialFriendRosterBaselineInput, WebClient,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::RawJson;
use vrcx_0_host::app_paths::{AppDataDirResolution, AppPaths};
use vrcx_0_host::auto_launch::{
    deserialize_app_launcher_entries, normalize_app_launcher_entries, AppLauncherEntry,
    AppLauncherSnapshot, AutoAppLaunchManager, APP_LAUNCHER_ENABLED_CONFIG_KEY,
    APP_LAUNCHER_ENTRIES_CONFIG_KEY,
};
use vrcx_0_host::discord_rpc::DiscordRpc;
use vrcx_0_host::host_capabilities::{
    current_host_capabilities, is_host_capability_available, HostCapability,
};
use vrcx_0_persistence::legacy_migration::{
    cleanup_legacy_updater_files, consume_pending_legacy_migration, LegacyMigrationPaths,
};
use vrcx_0_persistence::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use vrcx_0_persistence::profile_backup::{
    cleanup_profile_backup_artifacts, consume_pending_profile_restore, ProfileRestoreFailureCode,
};
use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint;

mod auth_session;
mod background;
mod background_auth;
mod background_ticks;
mod capabilities;
mod frontend_session;
mod profile_lock;
mod runtime_host_state;
mod services;
mod startup;

use auth_session::{string_field, BackendSocialBaseline};
pub use auth_session::{CliLoginPrompt, CliTwoFactorChoice};
use background::{
    background_capability_session, background_capability_session_matches, emit_background_error,
    emit_background_info, emit_background_info_if_changed, gui_maintenance_runtime_mode,
    read_group_order,
};
use background_ticks::{
    run_background_current_user_refresh, run_background_discord_tick,
    run_background_group_instance_refresh, run_background_moderation_refresh,
    run_background_presence_tick, run_background_print_cleanup,
    run_background_social_baseline_refresh, BackgroundTickContext,
};
use frontend_session::{
    favorite_group_membership_from_snapshot,
    replace_backend_frontend_session_user_if_session_matches, session_slot_matches,
    update_backend_frontend_session_user_filtered_if_session_matches,
    update_backend_frontend_session_user_if_session_matches,
};
use profile_lock::{AtomicFlagGuard, BackendStartGuard, ProfileLock};
#[cfg(test)]
use runtime_host_state::web_ua_app_version;
use runtime_host_state::VrOverlayProcessSink;
pub use runtime_host_state::{
    BackendRuntimeFrontendSessionSnapshot, RuntimeHostOptions, RuntimeHostState,
};
const SAVED_CREDENTIALS_KEY: &str = "savedCredentials";
const PROFILE_LOCK_FILE: &str = "runtime.lock";
const REGISTRY_BACKUP_MAINTENANCE_JOB: &str = "registryBackupMaintenance";
const REGISTRY_BACKUP_MAINTENANCE_CADENCE_SECONDS: u64 = 3 * 60 * 60;
const BACKGROUND_PRESENCE_AUTOMATION_JOB: &str = "backgroundPresenceAutomation";
const BACKGROUND_DISCORD_PRESENCE_JOB: &str = "backgroundDiscordPresence";
const BACKGROUND_FACTS_REFRESH_JOB: &str = "backgroundFactsRefresh";
const BACKGROUND_MODERATION_REFRESH_JOB: &str = "backgroundModerationRefresh";
const BACKGROUND_PRINT_CLEANUP_JOB: &str = "printAutoCleanup";
const BACKGROUND_PRESENCE_CADENCE_SECONDS: u64 = 3;
const BACKGROUND_DISCORD_CADENCE_SECONDS: u64 = 3;
const BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS: u64 = 300;
const BACKGROUND_CURRENT_USER_CADENCE_SECONDS: u64 = 300;
const BACKGROUND_OVERLAY_ACTIVITY_CONFIG_CADENCE_SECONDS: u64 = 5;
const BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS: u64 = 3_600;
const BACKGROUND_MODERATION_CADENCE_SECONDS: u64 = 3_600;
const BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS: u64 = 30 * 60;
const CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS: &[&str] = &[
    "friends",
    "onlineFriends",
    "activeFriends",
    "offlineFriends",
    "status",
    "statusDescription",
    "state",
    "stateBucket",
    "pendingOffline",
    "location",
    "$location",
    "$location_at",
    "locationUpdatedAt",
    "worldId",
    "instanceId",
    "travelingToLocation",
    "travelingToWorld",
    "travelingToInstance",
    "$travelingToLocation",
    "$travelingToTime",
    "travelingToTime",
    "$previousLocation",
    "$previousLocation_at",
];

#[cfg(test)]
mod web_ua_tests {
    use super::web_ua_app_version;

    #[test]
    fn keeps_plain_version_outside_headless() {
        assert_eq!(web_ua_app_version("2.9.2", false), "2.9.2");
    }

    #[test]
    fn tags_headless_builds_without_extra_slash() {
        let version = web_ua_app_version("2.9.2", true);
        assert_eq!(version, "2.9.2 (hl)");
        assert!(!version.contains('/'));
    }
}
