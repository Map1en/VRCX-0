use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc, Mutex};

use serde_json::Value;

use super::{
    profile_lock::ProfileLock, replace_authenticated_session_user_if_session_matches,
    RuntimeHostSocialMaintenanceActions,
};
use crate::{
    GroupOrderSource, Result, RuntimeHostComposition, RuntimeHostContext,
    RuntimeHostDesktopAssemblyDeps, RuntimeHostProfile, RuntimeHostProfileExtension,
    UnavailableGroupOrderSource,
};
use vrcx_0_application::auth::{
    AuthenticatedSessionMaintenanceRuntime, AuthenticatedSessionProjection,
    BackgroundAuthRecoveryOrchestrator,
};
use vrcx_0_application::collections::SharedCollectionImportRuntime;
use vrcx_0_application::favorites::{FavoriteImportRuntime, FavoriteImportRuntimeDeps};
use vrcx_0_application::profile::{DataDirMigrationRuntime, ProfileBackupRuntime};
use vrcx_0_application::social::{
    favorite_group_membership_from_baseline, AuthenticatedRuntimeDeps,
    AuthenticatedRuntimeFavoritesSink, AuthenticatedRuntimeOrchestrator, GroupApiDeps,
    GroupBanImportRuntime, NoteExportRuntime, PrintCleanupDeps, PrintCleanupQueueSink,
    SocialMaintenanceRuntime,
};
use vrcx_0_application_activity::ActivityWarmupRuntime;
use vrcx_0_application_core::{
    BackendRuntime, BackendRuntimeStatusPublisher, BackgroundCapabilitySession, ImageCache,
    RuntimeTaskExecutor, TaskStopReport, UnavailableLocalGameContextSource, WebClient,
};
use vrcx_0_application_realtime::{
    FriendProjectionSink, RealtimeCurrentUserSnapshotSink, RealtimeHostRuntime,
    RealtimeHostRuntimeDeps, RealtimeSessionContext,
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
use vrcx_0_platform::app_paths::{
    app_data_paths_match, commit_app_data_dir_pointer, AppDataDirResolution, AppDataDirSource,
    AppPaths,
};

#[cfg(test)]
use std::sync::atomic::Ordering;
#[cfg(test)]
use vrcx_0_application_core::BackendRuntimePhase;

pub struct RuntimeHostOptions {
    pub realtime_origin: String,
    pub launched_from_autostart: bool,
    pub app_data_dir: AppDataDirResolution,
    pub app_version: String,
    pub profile: RuntimeHostProfile,
    pub database_maintenance_cache_dir: Option<PathBuf>,
}

pub(super) fn web_ua_app_version(app_version: &str, profile: RuntimeHostProfile) -> String {
    match profile {
        RuntimeHostProfile::Desktop => app_version.to_string(),
        RuntimeHostProfile::HeadlessData => format!("{app_version} (hl)"),
    }
}

pub struct RuntimeHostStateBuilder {
    profile: RuntimeHostProfile,
    app_data_dir: AppDataDirResolution,
    paths: AppPaths,
    storage: Arc<StorageService>,
    db: Arc<DatabaseService>,
    profile_backup: ProfileBackupRuntime,
    data_dir_migration: DataDirMigrationRuntime,
    runtime_context: Arc<RuntimeHostContext>,
    desktop_assembly: RuntimeHostDesktopAssemblyDeps,
    backend_runtime: BackendRuntime,
    web: Arc<WebClient>,
    image_cache: Arc<ImageCache>,
    legacy_vrcx_available: bool,
    legacy_vrcx_source: Option<LegacyVrcxSource>,
    legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
    launched_from_autostart: bool,
    database_maintenance_cache_dir: Option<PathBuf>,
    profile_lock: ProfileLock,
}

pub struct RuntimeHostState {
    pub(crate) profile: RuntimeHostProfile,
    pub(crate) app_data_dir: AppDataDirResolution,
    pub(crate) paths: AppPaths,
    pub(crate) storage: Arc<StorageService>,
    pub(crate) db: Arc<DatabaseService>,
    pub(crate) profile_backup: ProfileBackupRuntime,
    pub(crate) data_dir_migration: DataDirMigrationRuntime,
    pub(crate) runtime_context: Arc<RuntimeHostContext>,
    desktop_assembly: RuntimeHostDesktopAssemblyDeps,
    pub(crate) backend_runtime: BackendRuntime,
    pub(crate) realtime_runtime: Arc<RealtimeHostRuntime>,
    pub(crate) web: Arc<WebClient>,
    pub(crate) image_cache: Arc<ImageCache>,
    pub(crate) authenticated_runtime: AuthenticatedRuntimeOrchestrator,
    pub(crate) favorite_import: FavoriteImportRuntime,
    pub(crate) group_ban_import: GroupBanImportRuntime,
    pub(crate) shared_collection_import: SharedCollectionImportRuntime,
    pub(crate) note_export: NoteExportRuntime,
    pub(crate) group_order_source: Arc<dyn GroupOrderSource>,
    pub(crate) legacy_vrcx_available: bool,
    pub(crate) legacy_vrcx_source: Option<LegacyVrcxSource>,
    pub(crate) legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
    pub(crate) launched_from_autostart: bool,
    pub(crate) database_maintenance_cache_dir: Option<PathBuf>,
    pub(super) profile_extension: Option<Arc<dyn RuntimeHostProfileExtension>>,
    pub(super) backend_starting: AtomicBool,
    pub(super) background_auth_recovery: BackgroundAuthRecoveryOrchestrator,
    pub(super) authenticated_session_maintenance: AuthenticatedSessionMaintenanceRuntime,
    pub(super) social_maintenance: SocialMaintenanceRuntime,
    pub(super) activity_warmup: ActivityWarmupRuntime,
    pub(super) background_group_instances_refresh_running: Arc<AtomicBool>,
    pub(super) authenticated_session_projection: Arc<Mutex<AuthenticatedSessionProjection>>,
    pub(super) _profile_lock: ProfileLock,
}

fn prepare_secrets_at_rest(db: &Arc<DatabaseService>, profile: RuntimeHostProfile) {
    let allow_encrypted_writes = match profile {
        RuntimeHostProfile::Desktop => true,
        RuntimeHostProfile::HeadlessData => false,
    };
    let mut startup =
        vrcx_0_outbound_adapters::LocalSecretStartup::new(Arc::clone(db), allow_encrypted_writes);
    vrcx_0_application::profile::run_secret_startup(&mut startup);
}

struct PreparedDataDirMigration {
    journal: PendingDataDirMigration,
    outcome: DataDirMigrationFinalizeOutcome,
}

struct OpenedProfile {
    storage: Arc<StorageService>,
    db: Arc<DatabaseService>,
    legacy_vrcx_available: bool,
    legacy_vrcx_source: Option<LegacyVrcxSource>,
    legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
}

fn set_active_data_dir(resolution: &mut AppDataDirResolution, path: PathBuf) {
    resolution.current_dir = path.clone();
    if app_data_paths_match(&path, &resolution.default_dir) {
        resolution.persisted_dir = None;
        resolution.source = AppDataDirSource::Default;
    } else {
        resolution.persisted_dir = Some(path);
        resolution.source = AppDataDirSource::Persisted;
    }
}

fn prepare_data_dir_migration_startup(
    resolution: &mut AppDataDirResolution,
) -> Result<Option<PreparedDataDirMigration>> {
    if resolution.source == AppDataDirSource::Cli {
        return Ok(None);
    }
    let Some(journal) = read_pending_data_dir_migration(&resolution.default_dir)? else {
        return Ok(None);
    };
    match journal.phase {
        DataDirMigrationJournalPhase::Copying => {
            if !app_data_paths_match(&resolution.current_dir, Path::new(&journal.source_dir)) {
                return Err(crate::Error::Custom(format!(
                    "Interrupted data directory migration does not match the active directory: {}",
                    resolution.current_dir.display()
                )));
            }
            cleanup_interrupted_data_dir_migration(&resolution.default_dir, &journal)?;
            Ok(None)
        }
        DataDirMigrationJournalPhase::Switched => {
            let source_dir = PathBuf::from(&journal.source_dir);
            let target_dir = PathBuf::from(&journal.target_dir).canonicalize()?;
            if app_data_paths_match(&resolution.current_dir, &source_dir) {
                commit_app_data_dir_pointer(&resolution.default_dir, &target_dir)?;
                set_active_data_dir(resolution, target_dir);
            } else if !app_data_paths_match(&resolution.current_dir, &target_dir) {
                return Err(crate::Error::Custom(format!(
                    "Pending data directory migration does not match the active directory: {}",
                    resolution.current_dir.display()
                )));
            }
            let outcome = finalize_data_dir_migration(&resolution.default_dir, &journal)?;
            Ok(Some(PreparedDataDirMigration { journal, outcome }))
        }
    }
}

fn open_profile(paths: &AppPaths) -> Result<OpenedProfile> {
    let migration_paths = LegacyMigrationPaths::from_app_data(paths.app_data.clone());
    consume_pending_legacy_migration(&migration_paths)?;
    let pending_profile_restore = consume_pending_profile_restore(&paths.app_data, &paths.db_file)?;
    if let Err(error) = cleanup_profile_backup_artifacts(&paths.app_data) {
        tracing::warn!(error = %error, "failed to clean up profile backup artifacts");
    }
    let legacy_vrcx_discovery = vrcx_0_persistence::legacy_vrcx::discover_legacy_vrcx_migration(
        &paths.db_file,
        &paths.config_file,
    );
    let legacy_vrcx_source = legacy_vrcx_discovery.importable_source;
    let legacy_vrcx_migration_status = legacy_vrcx_discovery.status;
    let legacy_vrcx_available = legacy_vrcx_migration_status.available;
    let storage = Arc::new(StorageService::new(&paths.config_file)?);
    let db = match DatabaseService::new(&paths.db_file) {
        Ok(db) => {
            if let Some(pending) = pending_profile_restore {
                if let Err(error) = pending.finalize() {
                    tracing::warn!(
                        error = %error,
                        "failed to finalize profile restore; journal remains for the next start"
                    );
                }
            }
            db
        }
        Err(error) => {
            let Some(pending) = pending_profile_restore else {
                return Err(error.into());
            };
            pending.rollback(ProfileRestoreFailureCode::DatabaseOpenFailed)?;
            DatabaseService::new(&paths.db_file)?
        }
    };
    Ok(OpenedProfile {
        storage,
        db: Arc::new(db),
        legacy_vrcx_available,
        legacy_vrcx_source,
        legacy_vrcx_migration_status,
    })
}

fn rollback_failed_data_dir_migration_startup(
    resolution: &mut AppDataDirResolution,
    prepared: &PreparedDataDirMigration,
) -> Result<()> {
    let source_dir = PathBuf::from(&prepared.journal.source_dir).canonicalize()?;
    commit_app_data_dir_pointer(&resolution.default_dir, &source_dir)?;
    record_data_dir_migration_database_open_failure(&resolution.default_dir, &prepared.journal)?;
    set_active_data_dir(resolution, source_dir);
    Ok(())
}

impl RuntimeHostStateBuilder {
    pub fn new(options: RuntimeHostOptions) -> Result<Self> {
        let RuntimeHostOptions {
            realtime_origin,
            launched_from_autostart,
            mut app_data_dir,
            app_version,
            profile,
            database_maintenance_cache_dir,
        } = options;
        let prepared_migration = prepare_data_dir_migration_startup(&mut app_data_dir)?;
        let mut paths = AppPaths::from_app_data(app_data_dir.current_dir.clone());
        let mut profile_lock = ProfileLock::acquire(&paths.app_data)?;
        let opened = match open_profile(&paths) {
            Ok(opened) => opened,
            Err(error) => {
                let Some(prepared) = prepared_migration.as_ref() else {
                    return Err(error);
                };
                tracing::warn!(error = %error, "migrated database failed to open; rolling back data directory pointer");
                drop(profile_lock);
                rollback_failed_data_dir_migration_startup(&mut app_data_dir, prepared)?;
                paths = AppPaths::from_app_data(app_data_dir.current_dir.clone());
                profile_lock = ProfileLock::acquire(&paths.app_data)?;
                open_profile(&paths)?
            }
        };
        if let Some(prepared) = prepared_migration.as_ref() {
            if app_data_paths_match(&paths.app_data, Path::new(&prepared.journal.target_dir)) {
                if let Err(error) = complete_data_dir_migration(
                    &app_data_dir.default_dir,
                    &prepared.journal,
                    &prepared.outcome,
                ) {
                    tracing::warn!(error = %error, "failed to complete data directory migration startup journal");
                }
            }
        }
        let OpenedProfile {
            storage,
            db,
            legacy_vrcx_available,
            legacy_vrcx_source,
            legacy_vrcx_migration_status,
        } = opened;
        prepare_secrets_at_rest(&db, profile);
        let web = Arc::new(WebClient::new(
            vrcx_0_outbound_adapters::LocalWebClientAdapter::new(
                &storage,
                Arc::clone(&db),
                realtime_origin,
                &web_ua_app_version(&app_version, profile),
            )?,
        ));
        let image_cache = Arc::new(ImageCache::new(Arc::new(
            vrcx_0_outbound_adapters::LocalImageCacheAdapter::new(
                paths.image_cache.clone(),
                Arc::clone(&web),
            )?,
        )));
        let runtime_context = Arc::new(RuntimeHostContext::new(
            Arc::clone(&db),
            Arc::clone(&web),
            Arc::clone(&image_cache),
        ));
        let desktop_assembly =
            RuntimeHostDesktopAssemblyDeps::from_context(Arc::clone(&runtime_context));
        let profile_backup_port = Arc::new(vrcx_0_outbound_adapters::LocalProfileBackupPort::new(
            vrcx_0_outbound_adapters::LocalProfileBackupDeps::new(
                paths.app_data.clone(),
                app_data_dir.default_dir.clone(),
                Arc::clone(&db),
                Arc::clone(&storage),
                runtime_context.event_bus.clone(),
                runtime_context.tasks.clone(),
                runtime_context.background_jobs.clone(),
                app_version.clone(),
            ),
        ));
        let profile_backup = ProfileBackupRuntime::new(profile_backup_port);
        let pointer_control_dir = app_data_dir.default_dir.clone();
        let data_dir_migration_port =
            Arc::new(vrcx_0_outbound_adapters::LocalDataDirMigrationPort::new(
                paths.app_data.clone(),
                app_data_dir.default_dir.clone(),
                Arc::clone(&db),
                runtime_context.event_bus.clone(),
                profile_backup.operation_gate(),
                Arc::new(move |target| {
                    commit_app_data_dir_pointer(&pointer_control_dir, target)
                        .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))
                }),
            ));
        let data_dir_migration = DataDirMigrationRuntime::new(data_dir_migration_port);

        Ok(Self {
            profile,
            app_data_dir,
            paths,
            storage,
            db,
            profile_backup,
            data_dir_migration,
            runtime_context,
            desktop_assembly,
            backend_runtime: BackendRuntime::new(profile),
            web,
            image_cache,
            legacy_vrcx_available,
            legacy_vrcx_source,
            legacy_vrcx_migration_status,
            launched_from_autostart,
            database_maintenance_cache_dir,
            profile_lock,
        })
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn storage(&self) -> &Arc<StorageService> {
        &self.storage
    }

    pub fn database(&self) -> &Arc<DatabaseService> {
        &self.db
    }

    pub fn profile_backup(&self) -> &ProfileBackupRuntime {
        &self.profile_backup
    }

    pub fn desktop_assembly(&self) -> &RuntimeHostDesktopAssemblyDeps {
        &self.desktop_assembly
    }

    pub fn backend_runtime(&self) -> &BackendRuntime {
        &self.backend_runtime
    }

    pub fn web_client(&self) -> &Arc<WebClient> {
        &self.web
    }

    pub fn finish(self, composition: RuntimeHostComposition) -> Result<RuntimeHostState> {
        match self.profile {
            RuntimeHostProfile::Desktop => {
                if composition.profile_extension.is_none() {
                    return Err(crate::Error::Custom(
                        "Desktop runtime profile requires a profile extension.".into(),
                    ));
                }
            }
            RuntimeHostProfile::HeadlessData => {
                if composition.profile_extension.is_some() {
                    return Err(crate::Error::Custom(
                        "HeadlessData runtime profile must not receive a profile extension.".into(),
                    ));
                }
            }
        }
        let RuntimeHostComposition {
            local_game_context,
            group_order_source,
            friend_projection_observer,
            profile_extension,
        } = composition;
        let authenticated_session_projection =
            Arc::new(Mutex::new(AuthenticatedSessionProjection::default()));
        let current_user_snapshot_sink: Option<RealtimeCurrentUserSnapshotSink> = {
            let session_slot = Arc::clone(&authenticated_session_projection);
            Some(Arc::new(
                move |session: &RealtimeSessionContext,
                      auth_scope_generation: u64,
                      snapshot: Value| {
                    let expected = BackgroundCapabilitySession {
                        auth_scope_generation,
                        current_user_id: session.user_id.clone(),
                        endpoint: session.endpoint.clone(),
                        websocket: session.websocket.clone(),
                        current_user_snapshot: Value::Null.into(),
                    };
                    replace_authenticated_session_user_if_session_matches(
                        &session_slot,
                        &expected,
                        snapshot,
                    );
                },
            ))
        };
        let realtime_store: Arc<dyn vrcx_0_application_realtime::RealtimeStore> =
            Arc::new(vrcx_0_outbound_adapters::PersistenceRealtimeStore::new(
                Arc::clone(&self.runtime_context.db),
            ));
        let remote_requests: Arc<dyn vrcx_0_application_realtime::RealtimeRemoteRequests> =
            Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeRemoteRequests);
        let backend_status = BackendRuntimeStatusPublisher::new(
            self.backend_runtime.clone(),
            self.runtime_context.event_bus.clone(),
        );
        let realtime_transport: Arc<dyn vrcx_0_application_realtime::RealtimeTransport> =
            Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeTransport::new(
                Arc::clone(&realtime_store),
                Arc::clone(&self.runtime_context.web),
                backend_status.clone(),
            ));
        let realtime_runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps::new(
            realtime_store,
            realtime_transport,
            remote_requests,
            Arc::clone(&self.runtime_context.web),
            self.runtime_context.event_bus.clone(),
            backend_status,
            FriendProjectionSink::new(
                self.runtime_context.event_bus.clone(),
                friend_projection_observer,
            ),
            self.runtime_context.sync.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.session.clone(),
            self.runtime_context.auth_scope.clone(),
            Arc::clone(&self.runtime_context.remote_mutations),
            local_game_context,
            Some(Arc::new(self.runtime_context.overlay_activity())),
            Some(Arc::new(
                self.runtime_context
                    .realtime_notification_projection_observer_registry(),
            )),
            Arc::clone(&self.runtime_context.world_cache),
            Arc::clone(&self.runtime_context.instance_dwell),
            Arc::new(PrintCleanupQueueSink::new(
                self.runtime_context.print_cleanup.clone(),
                self.runtime_context.tasks.clone(),
                PrintCleanupDeps::new(
                    self.runtime_context.print_adapter.clone(),
                    self.runtime_context.print_adapter.clone(),
                    self.runtime_context.event_bus.clone(),
                    self.runtime_context.auth_scope.clone(),
                    Arc::clone(&self.runtime_context.remote_mutations),
                ),
            )),
            current_user_snapshot_sink,
        )));
        let favorites_sink = {
            let overlay_activity = self.runtime_context.overlay_activity();
            Some(Arc::new(
                move |snapshot: &vrcx_0_application_realtime::FavoriteBaselineSnapshot| {
                    overlay_activity.set_favorite_groups(
                        vrcx_0_application_activity::OverlayFavoriteGroups::from_map(
                            favorite_group_membership_from_baseline(snapshot),
                        ),
                    );
                },
            ) as Arc<dyn AuthenticatedRuntimeFavoritesSink>)
        };
        let authenticated_runtime =
            AuthenticatedRuntimeOrchestrator::new(AuthenticatedRuntimeDeps {
                social_baseline: vrcx_0_application_realtime::SocialBaselineDeps::new(
                    Arc::new(vrcx_0_outbound_adapters::PersistenceRealtimeStore::new(
                        Arc::clone(&self.db),
                    )),
                    Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeRemoteRequests),
                    Arc::clone(&self.web),
                    self.runtime_context.auth_scope.clone(),
                ),
                auth_probe: Arc::new(
                    vrcx_0_outbound_adapters::VrchatAuthenticatedRuntimeAuthProbe::new(Arc::clone(
                        &self.web,
                    )),
                ),
                lifecycle_trail: Arc::new(
                    vrcx_0_outbound_adapters::LocalAuthenticatedRuntimeLifecycleTrail::new(
                        self.db.as_ref(),
                    ),
                ),
                event_bus: self.runtime_context.event_bus.clone(),
                tasks: self.runtime_context.tasks.clone(),
                auth_scope: self.runtime_context.auth_scope.clone(),
                realtime_runtime: Arc::clone(&realtime_runtime),
                favorites_sink,
            });
        let favorite_import = FavoriteImportRuntime::new(FavoriteImportRuntimeDeps::new(
            Arc::clone(&self.runtime_context.favorite_store),
            Arc::clone(&self.runtime_context.favorite_remote),
            Arc::clone(&self.runtime_context.world_cache),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
            Arc::clone(&self.runtime_context.remote_mutations),
            self.runtime_context.favorite_mutations.clone(),
        ));
        let group_ban_import = GroupBanImportRuntime::new(
            Arc::new(vrcx_0_outbound_adapters::LocalGroupBanImportActions {
                deps: GroupApiDeps::new(
                    Arc::new(vrcx_0_outbound_adapters::VrchatRequestAdapter::new(
                        Arc::clone(&self.web),
                    )),
                    Arc::new(vrcx_0_outbound_adapters::VrchatGroupRemoteRequests),
                    self.runtime_context.diagnostics.clone(),
                    self.runtime_context.sync.clone(),
                    self.runtime_context.auth_scope.clone(),
                    Arc::clone(&self.runtime_context.remote_mutations),
                ),
            }),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
        );
        let shared_collection_import = SharedCollectionImportRuntime::new(
            Arc::new(
                vrcx_0_outbound_adapters::LocalSharedCollectionImportActionsFactory::new(
                    Arc::clone(&self.db),
                    Arc::clone(&self.web),
                    Arc::clone(&self.runtime_context.world_cache),
                ),
            ),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
            Arc::new(self.runtime_context.favorite_mutations.clone()),
        );
        let note_export = NoteExportRuntime::new(
            Arc::new(vrcx_0_outbound_adapters::VrchatRequestAdapter::new(
                Arc::clone(&self.web),
            )),
            Arc::new(vrcx_0_outbound_adapters::VrchatNoteExportRemoteRequests),
            self.runtime_context.event_bus.clone(),
            self.runtime_context.tasks.clone(),
            self.runtime_context.auth_scope.clone(),
        );
        let activity_warmup = ActivityWarmupRuntime::new(
            self.runtime_context.auth_scope.clone(),
            self.runtime_context.tasks.clone(),
            Arc::new(
                vrcx_0_outbound_adapters::LocalActivitySessionWarmupStore::new(Arc::clone(
                    &self.db,
                )),
            ),
            Arc::new(vrcx_0_outbound_adapters::LocalActivityPageWarmupStore::new(
                Arc::clone(&self.db),
            )),
        );
        let authenticated_session_maintenance = AuthenticatedSessionMaintenanceRuntime::new(
            self.runtime_context.auth_scope.clone(),
            self.runtime_context.tasks.clone(),
            Arc::new(
                vrcx_0_outbound_adapters::LocalAuthenticatedSessionMaintenance::new(Arc::clone(
                    &self.db,
                )),
            ),
        );
        let background_group_instances_refresh_running = Arc::new(AtomicBool::new(false));
        let social_maintenance = SocialMaintenanceRuntime::new(
            Arc::new(RuntimeHostSocialMaintenanceActions {
                db: Arc::clone(&self.db),
                web: Arc::clone(&self.web),
                session_slot: Arc::clone(&authenticated_session_projection),
                realtime_runtime: Arc::clone(&realtime_runtime),
                runtime_context: Arc::clone(&self.runtime_context),
                backend_runtime: self.backend_runtime.clone(),
                background_jobs: self.runtime_context.background_jobs.clone(),
                authenticated_runtime: authenticated_runtime.clone(),
                group_instances_refresh_running: Arc::clone(
                    &background_group_instances_refresh_running,
                ),
                group_order_source: Arc::clone(&group_order_source),
            }),
            self.runtime_context.background_jobs.clone(),
            self.runtime_context.tasks.clone(),
        );
        Ok(RuntimeHostState {
            profile: self.profile,
            app_data_dir: self.app_data_dir,
            paths: self.paths,
            storage: self.storage,
            db: self.db,
            profile_backup: self.profile_backup,
            data_dir_migration: self.data_dir_migration,
            runtime_context: self.runtime_context,
            desktop_assembly: self.desktop_assembly,
            backend_runtime: self.backend_runtime,
            realtime_runtime,
            web: self.web,
            image_cache: self.image_cache,
            authenticated_runtime,
            favorite_import,
            group_ban_import,
            shared_collection_import,
            note_export,
            group_order_source,
            legacy_vrcx_available: self.legacy_vrcx_available,
            legacy_vrcx_source: self.legacy_vrcx_source,
            legacy_vrcx_migration_status: self.legacy_vrcx_migration_status,
            launched_from_autostart: self.launched_from_autostart,
            database_maintenance_cache_dir: self.database_maintenance_cache_dir,
            profile_extension,
            backend_starting: AtomicBool::new(false),
            background_auth_recovery: BackgroundAuthRecoveryOrchestrator::new(),
            authenticated_session_maintenance,
            social_maintenance,
            activity_warmup,
            background_group_instances_refresh_running,
            authenticated_session_projection,
            _profile_lock: self.profile_lock,
        })
    }
}

impl RuntimeHostState {
    pub fn set_task_executor<E>(&self, executor: E)
    where
        E: RuntimeTaskExecutor + 'static,
    {
        self.runtime_context.tasks.set_executor(executor);
    }

    pub fn stop_runtime_tasks(&self) -> TaskStopReport {
        self.runtime_context.tasks.stop_all()
    }

    pub fn app_data_dir(&self) -> &AppDataDirResolution {
        &self.app_data_dir
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn storage(&self) -> &Arc<StorageService> {
        &self.storage
    }

    pub fn database(&self) -> &Arc<DatabaseService> {
        &self.db
    }

    pub fn profile_backup(&self) -> &ProfileBackupRuntime {
        &self.profile_backup
    }

    pub fn data_dir_migration(&self) -> &DataDirMigrationRuntime {
        &self.data_dir_migration
    }

    pub fn desktop_assembly(&self) -> &RuntimeHostDesktopAssemblyDeps {
        &self.desktop_assembly
    }

    pub fn backend_runtime(&self) -> &BackendRuntime {
        &self.backend_runtime
    }

    pub fn realtime_runtime(&self) -> &Arc<RealtimeHostRuntime> {
        &self.realtime_runtime
    }

    pub fn web_client(&self) -> &Arc<WebClient> {
        &self.web
    }

    pub fn image_cache(&self) -> &Arc<ImageCache> {
        &self.image_cache
    }

    pub fn authenticated_runtime(&self) -> &AuthenticatedRuntimeOrchestrator {
        &self.authenticated_runtime
    }

    pub fn favorite_import(&self) -> &FavoriteImportRuntime {
        &self.favorite_import
    }

    pub fn group_ban_import(&self) -> &GroupBanImportRuntime {
        &self.group_ban_import
    }

    pub fn shared_collection_import(&self) -> &SharedCollectionImportRuntime {
        &self.shared_collection_import
    }

    pub fn note_export(&self) -> &NoteExportRuntime {
        &self.note_export
    }

    pub fn legacy_vrcx_available(&self) -> bool {
        self.legacy_vrcx_available
    }

    pub fn legacy_vrcx_source(&self) -> &Option<LegacyVrcxSource> {
        &self.legacy_vrcx_source
    }

    pub fn legacy_vrcx_migration_status(&self) -> &LegacyVrcxMigrationStatus {
        &self.legacy_vrcx_migration_status
    }

    pub fn launched_from_autostart(&self) -> bool {
        self.launched_from_autostart
    }

    pub fn new(options: RuntimeHostOptions) -> Result<Self> {
        match options.profile {
            RuntimeHostProfile::Desktop => {
                return Err(crate::Error::Custom(
                    "Desktop runtime profile must be constructed by runtime-host-desktop.".into(),
                ));
            }
            RuntimeHostProfile::HeadlessData => {}
        }
        RuntimeHostStateBuilder::new(options)?.finish(RuntimeHostComposition {
            local_game_context: Arc::new(UnavailableLocalGameContextSource),
            group_order_source: Arc::new(UnavailableGroupOrderSource),
            friend_projection_observer: None,
            profile_extension: None,
        })
    }

    pub fn authenticated_session_projection_handle(
        &self,
    ) -> Arc<Mutex<AuthenticatedSessionProjection>> {
        Arc::clone(&self.authenticated_session_projection)
    }
}

#[cfg(test)]
mod profile_bundle_tests;
