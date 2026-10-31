use std::path::{Path, PathBuf};

use vrcx_0_application::profile::{
    DataDirMigrationActionOutcome, DataDirMigrationMode, DataDirMigrationPlan,
    DataDirMigrationRuntime, DataDirMigrationStatus,
};
use vrcx_0_composition::Result;
use vrcx_0_platform::app_paths::{
    self, app_data_paths_match, AppDataDirResolution, AppDataDirSource, AppPaths,
};

pub use vrcx_0_persistence::data_dir_migration::{
    DataDirCleanupPending, DataDirCleanupReport, DataDirMigrationResult,
    DataDirMigrationTargetState,
};

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDataDirState {
    pub current_dir: String,
    pub default_dir: String,
    pub persisted_dir: Option<String>,
    pub cli_dir: Option<String>,
    pub source: AppDataDirSource,
    pub cli_override: bool,
    pub pending_migration: bool,
    pub cleanup_pending: Option<DataDirCleanupPending>,
    pub migration_status: DataDirMigrationStatus,
}

#[derive(Clone)]
pub struct DesktopDataDirRuntime {
    resolution: AppDataDirResolution,
    paths: AppPaths,
    migration: DataDirMigrationRuntime,
}

impl DesktopDataDirRuntime {
    pub fn new(
        resolution: AppDataDirResolution,
        paths: AppPaths,
        migration: DataDirMigrationRuntime,
    ) -> Self {
        Self {
            resolution,
            paths,
            migration,
        }
    }

    pub fn state(&self) -> Result<AppDataDirState> {
        let directory = app_paths::app_data_dir_state(&self.resolution)?;
        let mut cleanup_pending = self.migration.cleanup_pending()?;
        if let Some(pending) = cleanup_pending.as_mut() {
            if let Ok(bytes) = cleanup_manifest_size(Path::new(&pending.old_dir)) {
                pending.bytes = bytes;
            }
        }
        let pending_migration = has_pending_migration(&self.resolution.default_dir)
            || configured_data_dir_differs(&directory);
        Ok(AppDataDirState {
            current_dir: directory.current_dir,
            default_dir: directory.default_dir,
            persisted_dir: directory.persisted_dir,
            cli_dir: directory.cli_dir,
            source: directory.source,
            cli_override: directory.cli_override,
            pending_migration,
            cleanup_pending,
            migration_status: self.migration.current_status(),
        })
    }

    pub fn plan(&self, path: String) -> Result<DataDirMigrationPlan> {
        self.ensure_settings_available()?;
        let validation =
            app_paths::prepare_app_data_dir_migration_target(path, &self.resolution.current_dir)?;
        let target_path = PathBuf::from(&validation.path);
        Ok(vrcx_0_application::profile::build_data_dir_migration_plan(
            validation.path,
            migration_required_bytes(&self.paths.app_data)?,
            available_space(&target_path)?,
            inspect_migration_target(&target_path)?,
        )?)
    }

    pub fn request_migration(
        &self,
        path: String,
        mode: DataDirMigrationMode,
    ) -> Result<DataDirMigrationActionOutcome> {
        let plan = self.plan(path)?;
        Ok(self.migration.request_migration(plan, mode))
    }

    pub fn request_cancel(&self) -> DataDirMigrationActionOutcome {
        self.migration.request_cancel()
    }

    pub fn current_status(&self) -> DataDirMigrationStatus {
        self.migration.current_status()
    }

    pub fn take_last_result(&self) -> Result<Option<DataDirMigrationResult>> {
        Ok(self.migration.take_last_result()?)
    }

    pub fn cleanup_migrated_data(&self) -> Result<Option<DataDirCleanupReport>> {
        Ok(self.migration.cleanup_migrated_data()?)
    }

    pub fn dismiss_cleanup(&self) -> Result<()> {
        Ok(self.migration.dismiss_cleanup()?)
    }

    pub fn mark_cleanup_prompted(&self, prompted_at: String) -> Result<()> {
        Ok(self.migration.mark_cleanup_prompted(prompted_at)?)
    }

    fn ensure_settings_available(&self) -> Result<()> {
        if self.resolution.source == AppDataDirSource::Cli {
            return Err(vrcx_0_application_core::Error::Custom(
                "Data directory settings are disabled while --data-dir is active.".into(),
            )
            .into());
        }
        let directory = app_paths::app_data_dir_state(&self.resolution)?;
        if configured_data_dir_differs(&directory) {
            return Err(vrcx_0_application_core::Error::Custom(
                "Restart VRCX-0 before changing the data directory again.".into(),
            )
            .into());
        }
        Ok(())
    }
}

fn configured_data_dir_differs(state: &app_paths::AppDataDirState) -> bool {
    let configured = state.persisted_dir.as_deref().unwrap_or(&state.default_dir);
    !app_data_paths_match(Path::new(configured), Path::new(&state.current_dir))
}

fn cleanup_manifest_size(path: &Path) -> Result<u64> {
    Ok(vrcx_0_persistence::data_dir_migration::cleanup_manifest_size(path)?)
}

fn available_space(path: &Path) -> Result<u64> {
    Ok(vrcx_0_persistence::data_dir_migration::data_dir_available_space(path)?)
}

fn migration_required_bytes(path: &Path) -> Result<u64> {
    Ok(vrcx_0_persistence::data_dir_migration::data_dir_migration_required_bytes(path)?)
}

fn has_pending_migration(path: &Path) -> bool {
    vrcx_0_persistence::data_dir_migration::has_pending_data_dir_migration(path)
}

fn inspect_migration_target(path: &Path) -> Result<DataDirMigrationTargetState> {
    Ok(vrcx_0_persistence::data_dir_migration::inspect_data_dir_migration_target(path)?)
}
