use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    AuthenticatedRuntimeOrchestrator, GroupOrderSource, NoteExportRuntime, Result,
    RuntimeGroupInstancesProjection, RuntimeHostComposition, RuntimeHostContext,
    RuntimeHostEventSink, RuntimeHostProfile, RuntimeHostProfileExtension,
    SharedCollectionImportRuntime, UnavailableGroupOrderSource,
};
use vrcx_0_application::{
    auth_response_error_message, current_user_from_cookie, parse_current_user_response,
    probe_current_user_from_cookie, probe_saved_current_user_from_cookie, record_login_success,
    record_logout, saved_credential_login_start, saved_credential_session_data, saved_snapshot,
    AuthenticatedRuntimeSession, AuthenticatedSessionMaintenanceOutcome, AutoLoginOutcome,
    AutoLoginStartInput, CookieSessionProbe, DataDirMigrationRuntime, FavoriteImportRuntime,
    LoginRuntimeTransition, LoginSessionCancelInput, LoginSessionEnd, LoginSessionEndRequest,
    LoginSessionRespondInput, LoginSessionStartInput, LoginSessionState, LoginSuccessRecordInput,
    LogoutRecordInput, NonInteractiveAuthError, PrintCleanupDeps, PrintCleanupQueueSink,
    PrintCleanupTrigger, ProfileBackupRuntime, ProfileBackupRuntimeDeps, SavedAuthAutoLoginStatus,
    SavedAuthSnapshot, SavedCredentialLoginStartInput,
};
use vrcx_0_application_core::{
    BackendRuntime, BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot,
    BackendRuntimeTelemetry, BackgroundCapabilitySession, ImageCache, RuntimeBackgroundJobs,
    RuntimeEventSink, RuntimeRealtimeTransportEpoch, UnavailableLocalGameContextSource, WebClient,
};
use vrcx_0_application_realtime::{RealtimeHostRuntime, RealtimeHostRuntimeDeps};
use vrcx_0_host::app_paths::{
    app_data_paths_match, commit_app_data_dir_pointer, AppDataDirResolution, AppDataDirSource,
    AppPaths,
};
use vrcx_0_persistence::data_dir_migration::{
    cleanup_interrupted_data_dir_migration, complete_data_dir_migration,
    finalize_data_dir_migration, read_pending_data_dir_migration,
    record_data_dir_migration_database_open_failure, DataDirMigrationFinalizeOutcome,
    DataDirMigrationJournalPhase, PendingDataDirMigration,
};
use vrcx_0_persistence::legacy_migration::{
    consume_pending_legacy_migration, LegacyMigrationPaths,
};
use vrcx_0_persistence::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use vrcx_0_persistence::profile_backup::{
    cleanup_profile_backup_artifacts, consume_pending_profile_restore, ProfileRestoreFailureCode,
};
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint;

mod activity_warmup;
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

use auth_session::string_field;
pub use auth_session::{CliLoginPrompt, CliTwoFactorChoice};
use background::{
    background_capability_session, background_capability_session_matches, emit_background_info,
    emit_background_warning, gui_maintenance_runtime_mode,
};
use background_ticks::{
    run_background_current_user_refresh, run_background_group_instance_refresh,
    run_background_moderation_refresh, run_background_print_cleanup,
    run_background_social_baseline_refresh, BackgroundTickContext,
};
pub use frontend_session::{
    replace_backend_frontend_session_user_if_session_matches,
    update_backend_frontend_session_user_if_session_matches,
};
use frontend_session::{
    session_slot_matches, update_backend_frontend_session_user_filtered_if_session_matches,
};
use profile_lock::{AtomicFlagGuard, BackendStartGuard, ProfileLock};
#[cfg(test)]
use runtime_host_state::web_ua_app_version;
pub use runtime_host_state::{
    BackendRuntimeFrontendSessionSnapshot, RuntimeHostOptions, RuntimeHostState,
    RuntimeHostStateBuilder,
};
const PROFILE_LOCK_FILE: &str = "runtime.lock";
const BACKGROUND_CURRENT_USER_REFRESH_JOB: &str = "backgroundCurrentUserRefresh";
const BACKGROUND_GROUP_INSTANCE_REFRESH_JOB: &str = "backgroundGroupInstanceRefresh";
const BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB: &str = "backgroundSocialBaselineRefresh";
const BACKGROUND_MODERATION_REFRESH_JOB: &str = "backgroundModerationRefresh";
const BACKGROUND_PRINT_CLEANUP_JOB: &str = "printAutoCleanup";
const BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS: u64 = 300;
const BACKGROUND_CURRENT_USER_CADENCE_SECONDS: u64 = 300;
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
    use super::{
        web_ua_app_version, BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
        BACKGROUND_CURRENT_USER_REFRESH_JOB, BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
        BACKGROUND_GROUP_INSTANCE_REFRESH_JOB, BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
        BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
    };
    use crate::RuntimeHostProfile;

    #[test]
    fn keeps_plain_version_outside_headless() {
        assert_eq!(
            web_ua_app_version("2.9.2", RuntimeHostProfile::Desktop),
            "2.9.2"
        );
    }

    #[test]
    fn tags_headless_builds_without_extra_slash() {
        let version = web_ua_app_version("2.9.2", RuntimeHostProfile::HeadlessData);
        assert_eq!(version, "2.9.2 (hl)");
        assert!(!version.contains('/'));
    }

    #[test]
    fn social_maintenance_refreshes_keep_independent_job_slots_and_cadences() {
        assert_eq!(
            [
                (
                    BACKGROUND_CURRENT_USER_REFRESH_JOB,
                    BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
                ),
                (
                    BACKGROUND_GROUP_INSTANCE_REFRESH_JOB,
                    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
                ),
                (
                    BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
                    BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
                ),
            ],
            [
                ("backgroundCurrentUserRefresh", 300),
                ("backgroundGroupInstanceRefresh", 300),
                ("backgroundSocialBaselineRefresh", 3_600),
            ]
        );
    }
}
