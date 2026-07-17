use std::sync::{Arc, Mutex};

use super::{
    AuthenticatedRuntimeOrchestrator, BackendRuntime, BackendRuntimeFrontendSessionSnapshot,
    DatabaseService, RealtimeHostRuntime, RuntimeBackgroundJobs, RuntimeHostContext,
    VrOverlayRuntime, WebClient,
};

mod current_user;
mod discord;
mod group_instances;
mod maintenance;
mod moderation;
mod presence;
mod social_baseline;

pub(super) use current_user::run_background_current_user_refresh;
pub(super) use discord::run_background_discord_tick;
pub(super) use group_instances::run_background_group_instance_refresh;
pub(super) use maintenance::run_background_print_cleanup;
pub(super) use moderation::run_background_moderation_refresh;
pub(super) use presence::run_background_presence_tick;
pub(super) use social_baseline::run_background_social_baseline_refresh;

pub(super) struct BackgroundTickContext<'a> {
    pub(super) db: &'a Arc<DatabaseService>,
    pub(super) web: &'a Arc<WebClient>,
    pub(super) session_slot: &'a Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    pub(super) realtime_runtime: &'a Arc<RealtimeHostRuntime>,
    pub(super) vr_overlay_runtime: &'a Arc<VrOverlayRuntime>,
    pub(super) runtime_context: &'a Arc<RuntimeHostContext>,
    pub(super) backend_runtime: &'a BackendRuntime,
    pub(super) background_jobs: &'a RuntimeBackgroundJobs,
    pub(super) authenticated_runtime: &'a AuthenticatedRuntimeOrchestrator,
}
