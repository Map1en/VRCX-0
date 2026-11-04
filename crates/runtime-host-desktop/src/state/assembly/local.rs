use std::sync::Arc;

use vrcx_0_application::profile::{DatabaseUpgradeRuntime, ProfileConfigStore};
use vrcx_0_application::social::{FriendLogNameResolutionCoordinator, UserDialogTabCountsRuntime};
use vrcx_0_composition::RuntimeHostState;
use vrcx_0_outbound_adapters::{
    LocalFriendLogNameStore, LocalNotificationSyncAdapter, LocalTranslationAdapter,
    LocalUserDialogTabCountsSource, LocalWorldCollectionAdapter,
};

use crate::data_dir::DesktopDataDirRuntime;
use crate::local_data::LocalDataRuntime;
use crate::profile_backup::DesktopProfileBackupRuntime;
use crate::screenshot::DesktopScreenshotRuntime;
use crate::state::{DesktopRuntimeBundle, GameRuntimeBundle};
use crate::{DesktopDatabaseUpgradeRuntime, DesktopLegacyMigrationRuntime};

pub(crate) struct LocalRuntimes {
    pub(crate) local_data: LocalDataRuntime,
    pub(crate) data_dir: DesktopDataDirRuntime,
    pub(crate) profile_backup: DesktopProfileBackupRuntime,
    pub(crate) screenshots: DesktopScreenshotRuntime,
    pub(crate) database_upgrade: DesktopDatabaseUpgradeRuntime,
    pub(crate) legacy_migration: DesktopLegacyMigrationRuntime,
    pub(crate) world_collections: LocalWorldCollectionAdapter,
    pub(crate) friend_log_name_store: LocalFriendLogNameStore,
    pub(crate) notification_sync: LocalNotificationSyncAdapter,
    pub(crate) friend_log_name_resolutions: FriendLogNameResolutionCoordinator,
    pub(crate) user_dialog_tab_counts: UserDialogTabCountsRuntime,
    pub(crate) user_dialog_tab_counts_source: Arc<LocalUserDialogTabCountsSource>,
    pub(crate) translation: LocalTranslationAdapter,
}

pub(crate) fn build_local_runtimes(
    runtime: &RuntimeHostState,
    game: &GameRuntimeBundle,
    desktop: &DesktopRuntimeBundle,
    profile_config: &Arc<dyn ProfileConfigStore>,
) -> LocalRuntimes {
    let context = runtime.desktop_assembly();
    let local_data = LocalDataRuntime::new(
        Arc::clone(runtime.database()),
        Arc::clone(profile_config),
        Arc::clone(runtime.web_client()),
        context.auth_scope().clone(),
        context.tasks().clone(),
        Arc::clone(context.avatar_cache()),
        Arc::clone(context.world_cache()),
        context.file_cache().clone(),
        Arc::clone(runtime.realtime_runtime()),
        desktop.services.activity_router(),
        context.favorite_mutations().clone(),
        context.mutual_graph_fetch().clone(),
    );
    let data_dir = DesktopDataDirRuntime::new(
        runtime.app_data_dir().clone(),
        runtime.paths().clone(),
        runtime.data_dir_migration().clone(),
    );
    let profile_backup = DesktopProfileBackupRuntime::new(
        runtime.profile_backup().clone(),
        desktop.host_file_access.clone(),
        runtime.paths().clone(),
        Arc::clone(&desktop.feed_logger),
    );
    let screenshots = DesktopScreenshotRuntime::new(
        game.screenshot_cache.clone(),
        Arc::clone(runtime.database()),
        desktop.host_file_access.clone(),
        runtime.paths().clone(),
        vrcx_0_host_desktop::vrchat_paths::vrchat_photos_location(),
        context.event_bus().clone(),
        Arc::clone(runtime.web_client()),
    );
    let database_upgrade = DesktopDatabaseUpgradeRuntime::new(
        DatabaseUpgradeRuntime::new(
            Arc::new(vrcx_0_outbound_adapters::LocalDatabaseUpgradeStore::new(
                Arc::clone(runtime.database()),
            )),
            context.diagnostics().clone(),
            context.background_jobs().clone(),
        ),
        context.config().clone(),
        desktop.telemetry.clone(),
        runtime.paths().app_data.join("error-log.txt"),
    );
    let legacy_migration = DesktopLegacyMigrationRuntime::new(
        runtime.legacy_vrcx_migration_status().clone(),
        runtime.legacy_vrcx_source().clone(),
        vrcx_0_contracts::LegacyMigrationPaths::from_app_data(runtime.paths().app_data.clone()),
        database_upgrade.clone(),
    );
    LocalRuntimes {
        local_data,
        data_dir,
        profile_backup,
        screenshots,
        database_upgrade,
        legacy_migration,
        world_collections: LocalWorldCollectionAdapter::new(Arc::clone(runtime.database())),
        friend_log_name_store: LocalFriendLogNameStore::new(Arc::clone(runtime.database())),
        notification_sync: LocalNotificationSyncAdapter::new(
            Arc::clone(runtime.database()),
            Arc::clone(runtime.web_client()),
        ),
        friend_log_name_resolutions: FriendLogNameResolutionCoordinator::default(),
        user_dialog_tab_counts: UserDialogTabCountsRuntime::new(),
        user_dialog_tab_counts_source: Arc::new(LocalUserDialogTabCountsSource::new(
            Arc::clone(runtime.database()),
            Arc::clone(runtime.web_client()),
        )),
        translation: LocalTranslationAdapter::new(
            Arc::clone(runtime.database()),
            Arc::clone(runtime.web_client()),
        ),
    }
}
