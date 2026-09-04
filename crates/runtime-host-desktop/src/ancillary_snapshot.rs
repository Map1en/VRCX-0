use serde::Serialize;

use vrcx_0_application::profile::{
    AppUpdateDownloadStatusSnapshot, AppUpdateStatusSnapshot, BackgroundImageProjection,
    CommunityThemeProjection, DataDirMigrationStatus, ProfileBackupStatus,
};
use vrcx_0_application::social::MutualGraphFetchStatus;
use vrcx_0_application_core::HostSessionProjection;
use vrcx_0_application_game::{DebugLoggingOutcome, NowPlayingSnapshot};
use vrcx_0_host_desktop::host_capabilities::{is_host_capability_available, HostCapability};

use crate::notification::NotificationDoNotDisturbSnapshot;
use crate::state::DesktopRuntimeHostState;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AncillaryRuntimeSnapshot {
    pub community_theme_state: Option<CommunityThemeProjection>,
    pub profile_backup_current_status: ProfileBackupStatus,
    pub data_dir_migration_current_status: DataDirMigrationStatus,
    pub mutual_graph_fetch_status: MutualGraphFetchStatus,
    pub app_update_status: AppUpdateStatusSnapshot,
    pub app_update_download_status: AppUpdateDownloadStatusSnapshot,
    pub game_client_debug_logging_status: Option<DebugLoggingOutcome>,
    pub game_process_snapshot: Option<HostSessionProjection>,
    pub now_playing: NowPlayingSnapshot,
    pub background_image_state: BackgroundImageProjection,
    pub notification_do_not_disturb_state: NotificationDoNotDisturbSnapshot,
}

pub async fn ancillary_runtime_snapshot(
    state: &DesktopRuntimeHostState,
) -> AncillaryRuntimeSnapshot {
    let community_theme_state = match state.initialize_community_theme().await {
        Ok(projection) => Some(projection),
        Err(error) => {
            tracing::warn!(
                error = %error,
                "failed to hydrate community theme state for ancillary runtime snapshot"
            );
            None
        }
    };
    let game_process_snapshot = if is_host_capability_available(HostCapability::GameProcessMonitor)
    {
        Some(state.host_session_projection())
    } else {
        None
    };

    AncillaryRuntimeSnapshot {
        community_theme_state,
        profile_backup_current_status: state.profile_backup_status(),
        data_dir_migration_current_status: state.data_dir_migration_status(),
        mutual_graph_fetch_status: state.mutual_graph_fetch_status(),
        app_update_status: state.app_update_hydration_snapshot(),
        app_update_download_status: state.app_update_download_status(),
        game_client_debug_logging_status: state.game_client_debug_logging_status(),
        game_process_snapshot,
        now_playing: state.now_playing_snapshot(),
        background_image_state: state.background_image_projection(),
        notification_do_not_disturb_state: state.notification_do_not_disturb_snapshot(),
    }
}
