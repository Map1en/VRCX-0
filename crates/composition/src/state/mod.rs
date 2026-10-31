use crate::{Result, RuntimeHostContext, RuntimeHostEventSink, RuntimeHostProfile};
use vrcx_0_application::auth::{
    current_user_from_cookie, AuthenticatedRuntimeSession, AuthenticatedSessionProjection,
    AutoLoginOutcome, AutoLoginStartInput, LoginRuntimeTransition, LoginSessionCancelInput,
    LoginSessionEnd, LoginSessionEndRequest, LoginSessionRespondInput, LoginSessionStartInput,
    LoginSessionState, NonInteractiveAuthError, SavedAuthSnapshot,
};
use vrcx_0_application::social::{PrintCleanupDeps, PrintCleanupTrigger};
use vrcx_0_application_core::{
    BackendRuntime, BackendRuntimePhase, BackendRuntimeSnapshot, BackendRuntimeTelemetryKind,
    GuiRuntimeMode, RuntimeBackgroundJobs, RuntimeEventSink, RuntimeRealtimeTransportEpoch,
    WebClient,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_persistence::DatabaseService;

mod auth_session;
mod background;
mod background_auth;
mod background_ticks;
mod capabilities;
mod combined_snapshot;
mod frontend_session;
mod profile_lock;
mod runtime_host_state;
mod services;
mod startup;

pub use auth_session::{CliLoginPrompt, CliTwoFactorChoice};
use background::{
    background_capability_session, background_capability_session_identity,
    background_capability_session_matches, emit_background_info, emit_background_warning,
    gui_maintenance_runtime_mode, RuntimeHostSocialMaintenanceActions,
};
use background_ticks::{
    run_background_current_user_refresh, run_background_group_instance_notification_refresh,
    run_background_group_instance_refresh, run_background_moderation_refresh,
    run_background_print_cleanup, run_background_profile_bio_scan,
    run_background_social_baseline_refresh, BackgroundTickContext,
};
pub use combined_snapshot::BackendRuntimeCombinedSnapshot;
use profile_lock::{AtomicFlagGuard, SharedAtomicFlagGuard};
#[cfg(test)]
use runtime_host_state::web_ua_app_version;
pub use runtime_host_state::{RuntimeHostOptions, RuntimeHostState, RuntimeHostStateBuilder};
use vrcx_0_application::auth::replace_authenticated_session_user_if_session_matches;
pub use vrcx_0_application::social::SocialBaselineRefreshOutput;
const PROFILE_LOCK_FILE: &str = "runtime.lock";
pub(super) use vrcx_0_application::social::{
    BACKGROUND_CURRENT_USER_CADENCE_SECONDS, BACKGROUND_CURRENT_USER_REFRESH_JOB,
    BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS, BACKGROUND_GROUP_INSTANCE_REFRESH_JOB,
    BACKGROUND_MODERATION_CADENCE_SECONDS, BACKGROUND_MODERATION_REFRESH_JOB,
    BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS, BACKGROUND_PRINT_CLEANUP_JOB,
    BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS, BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
};
#[cfg(test)]
mod web_ua_tests {
    use super::{
        web_ua_app_version, BACKGROUND_CURRENT_USER_REFRESH_JOB,
        BACKGROUND_GROUP_INSTANCE_REFRESH_JOB, BACKGROUND_MODERATION_REFRESH_JOB,
        BACKGROUND_PRINT_CLEANUP_JOB, BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
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
    fn background_maintenance_jobs_use_distinct_job_slots() {
        let jobs = [
            BACKGROUND_CURRENT_USER_REFRESH_JOB,
            BACKGROUND_GROUP_INSTANCE_REFRESH_JOB,
            BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
            BACKGROUND_MODERATION_REFRESH_JOB,
            BACKGROUND_PRINT_CLEANUP_JOB,
        ];
        let unique = jobs.iter().collect::<std::collections::HashSet<_>>();

        assert_eq!(unique.len(), jobs.len());
    }
}
