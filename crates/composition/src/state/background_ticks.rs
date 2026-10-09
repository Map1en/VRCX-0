use std::sync::{Arc, Mutex};

use super::{
    AuthenticatedSessionProjection, BackendRuntime, DatabaseService, RealtimeHostRuntime,
    RuntimeBackgroundJobs, RuntimeHostContext, WebClient,
};
use vrcx_0_application::social::AuthenticatedRuntimeOrchestrator;

mod current_user;
mod group_instances;
mod maintenance;
mod moderation;
mod profile_bio;
mod social_baseline;

pub(super) use current_user::run_background_current_user_refresh;
pub(super) use group_instances::{
    run_background_group_instance_notification_refresh, run_background_group_instance_refresh,
};
pub(super) use maintenance::run_background_print_cleanup;
pub(super) use moderation::run_background_moderation_refresh;
pub(super) use profile_bio::run_background_profile_bio_scan;
pub(super) use social_baseline::run_background_social_baseline_refresh;

pub(super) struct BackgroundTickContext<'a> {
    pub(super) db: &'a Arc<DatabaseService>,
    pub(super) realtime_store: &'a Arc<dyn vrcx_0_application_realtime::RealtimeStore>,
    pub(super) web: &'a Arc<WebClient>,
    pub(super) session_slot: &'a Arc<Mutex<AuthenticatedSessionProjection>>,
    pub(super) realtime_runtime: &'a Arc<RealtimeHostRuntime>,
    pub(super) runtime_context: &'a Arc<RuntimeHostContext>,
    pub(super) backend_runtime: &'a BackendRuntime,
    pub(super) background_jobs: &'a RuntimeBackgroundJobs,
    pub(super) authenticated_runtime: &'a AuthenticatedRuntimeOrchestrator,
}
