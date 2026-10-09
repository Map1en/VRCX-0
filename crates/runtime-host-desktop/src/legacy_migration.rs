use std::sync::Arc;

pub use vrcx_0_contracts::{
    LegacyMigrationPaths, LegacyVrcxDiscovery, LegacyVrcxMigrationStatus, LegacyVrcxSource,
};

use crate::{DesktopDatabaseUpgradeRuntime, Error, Result};

pub trait LegacyMigrationLifecycle: Send + Sync {
    fn stop_runtime_services(&self);
    fn request_restart(&self);
    fn current_user_id(&self) -> Option<String> {
        None
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LegacyMigrationRequestMode {
    Configured,
    Force,
}

#[derive(Clone)]
pub struct DesktopLegacyMigrationRuntime {
    status: LegacyVrcxMigrationStatus,
    source: Option<LegacyVrcxSource>,
    paths: LegacyMigrationPaths,
    database_upgrade: DesktopDatabaseUpgradeRuntime,
}

impl DesktopLegacyMigrationRuntime {
    pub fn new(
        status: LegacyVrcxMigrationStatus,
        source: Option<LegacyVrcxSource>,
        paths: LegacyMigrationPaths,
        database_upgrade: DesktopDatabaseUpgradeRuntime,
    ) -> Self {
        Self {
            status,
            source,
            paths,
            database_upgrade,
        }
    }

    pub fn status(&self) -> LegacyVrcxMigrationStatus {
        self.status.clone()
    }

    pub fn is_legacy_vrcx_running(&self) -> bool {
        vrcx_0_host_desktop::process_status::detect_legacy_vrcx_running()
    }

    pub async fn force_status(&self) -> Result<LegacyVrcxMigrationStatus> {
        Ok(discover_supported_legacy_source().await?.status)
    }

    pub async fn request(
        &self,
        mode: LegacyMigrationRequestMode,
        allow_running_legacy_vrcx: bool,
        lifecycle: Arc<dyn LegacyMigrationLifecycle>,
    ) -> Result<bool> {
        ensure_legacy_vrcx_process_state(allow_running_legacy_vrcx, self.is_legacy_vrcx_running())?;
        let (source, unavailable_status) = match mode {
            LegacyMigrationRequestMode::Configured => (self.source.clone(), self.status.clone()),
            LegacyMigrationRequestMode::Force => {
                let discovery = discover_supported_legacy_source().await?;
                (discovery.importable_source, discovery.status)
            }
        };
        let source = source.ok_or_else(|| {
            Error::Custom(legacy_migration_unavailable_reason(&unavailable_status))
        })?;
        if let Some(connection) =
            vrcx_0_composition::RemoteDatabaseConnection::load(&self.paths.app_data)?
        {
            let owner_user_id = lifecycle
                .current_user_id()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| {
                    Error::Custom("Sign in before importing VRCX data into the server.".into())
                })?;
            self.upload_remote_import(connection, source, owner_user_id)
                .await?;
            // Reconnect normally after import so every view reads the server's new data.
            lifecycle.stop_runtime_services();
            lifecycle.request_restart();
            return Ok(true);
        }
        let plan = legacy_migration_execution_plan(mode, cfg!(debug_assertions));
        if plan.prepare_snapshot {
            self.database_upgrade
                .prepare_legacy_migration(self.paths.clone(), source)
                .await?;
        }
        if cfg!(debug_assertions) {
            match mode {
                LegacyMigrationRequestMode::Configured => tracing::warn!(
                    "app__request_legacy_migration: dev mode does not auto-restart or persist migration flag"
                ),
                LegacyMigrationRequestMode::Force => tracing::warn!(
                    "app__request_legacy_vrcx_force_migration: dev mode wrote migration flag but did not auto-restart"
                ),
            }
        }
        if plan.restart {
            lifecycle.stop_runtime_services();
            lifecycle.request_restart();
        }
        Ok(plan.result)
    }

    async fn upload_remote_import(
        &self,
        connection: vrcx_0_composition::RemoteDatabaseConnection,
        source: LegacyVrcxSource,
        owner_user_id: String,
    ) -> Result<()> {
        let snapshot = self
            .paths
            .app_data
            .join(format!("vrcx-import-{}.sqlite3", uuid::Uuid::new_v4()));
        let staged = snapshot.clone();
        let result = async {
            tokio::task::spawn_blocking(move || {
                vrcx_0_persistence::legacy_vrcx::validate_legacy_source(&source)
                    .map_err(Error::Custom)?;
                vrcx_0_persistence::legacy_migration::copy_database_snapshot(
                    &source.db_path,
                    &staged,
                    |_, _| {},
                )
                .map_err(Error::from)
            })
            .await
            .map_err(|error| Error::Custom(format!("VRCX snapshot failed: {error}")))??;
            let file = tokio::fs::File::open(&snapshot).await?;
            let size = file.metadata().await?.len();
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(3600))
                .build()
                .map_err(|_| Error::Custom("Could not create the import connection.".into()))?;
            let response = client
                .post(format!(
                    "{}/api/import-vrcx",
                    connection.server_url.trim_end_matches('/')
                ))
                .bearer_auth(connection.token)
                .header("X-VRCX-User-Id", owner_user_id)
                .header(reqwest::header::CONTENT_TYPE, "application/vnd.sqlite3")
                .header(reqwest::header::CONTENT_LENGTH, size)
                .body(reqwest::Body::wrap_stream(
                    tokio_util::io::ReaderStream::new(file),
                ))
                .send()
                .await
                .map_err(|_| Error::Custom("Could not upload VRCX data to the server.".into()))?;
            if !response.status().is_success() {
                let status = response.status();
                return Err(Error::Custom(format!(
                    "The server could not import VRCX data (HTTP {status})."
                )));
            }
            Ok(())
        }
        .await;
        // This is a temporary import snapshot, never an active desktop database.
        let _ = tokio::fs::remove_file(snapshot).await;
        result
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LegacyMigrationExecutionPlan {
    prepare_snapshot: bool,
    restart: bool,
    result: bool,
}

fn legacy_migration_execution_plan(
    mode: LegacyMigrationRequestMode,
    debug_build: bool,
) -> LegacyMigrationExecutionPlan {
    LegacyMigrationExecutionPlan {
        prepare_snapshot: mode == LegacyMigrationRequestMode::Force || !debug_build,
        restart: !debug_build,
        result: !debug_build,
    }
}

async fn discover_supported_legacy_source() -> Result<LegacyVrcxDiscovery> {
    tokio::task::spawn_blocking(vrcx_0_persistence::legacy_vrcx::discover_supported_legacy_source)
        .await
        .map_err(|error| Error::Custom(format!("legacy VRCX discovery task failed: {error}")))
}

fn legacy_migration_unavailable_reason(status: &LegacyVrcxMigrationStatus) -> String {
    status
        .reason
        .clone()
        .unwrap_or_else(|| "Legacy VRCX migration is unavailable.".to_string())
}

fn ensure_legacy_vrcx_process_state(
    allow_running_legacy_vrcx: bool,
    legacy_vrcx_running: bool,
) -> Result<()> {
    if !allow_running_legacy_vrcx && legacy_vrcx_running {
        return Err(Error::Custom(
            "VRCX is still running. Close it before migrating or explicitly allow migration while it is running."
                .into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_legacy_vrcx_process_state, legacy_migration_execution_plan,
        legacy_migration_unavailable_reason, LegacyMigrationExecutionPlan,
        LegacyMigrationRequestMode, LegacyVrcxMigrationStatus,
    };

    #[test]
    fn migration_plan_preserves_debug_and_release_behavior_for_both_entry_points() {
        for (mode, debug_build, expected) in [
            (
                LegacyMigrationRequestMode::Configured,
                true,
                LegacyMigrationExecutionPlan {
                    prepare_snapshot: false,
                    restart: false,
                    result: false,
                },
            ),
            (
                LegacyMigrationRequestMode::Configured,
                false,
                LegacyMigrationExecutionPlan {
                    prepare_snapshot: true,
                    restart: true,
                    result: true,
                },
            ),
            (
                LegacyMigrationRequestMode::Force,
                true,
                LegacyMigrationExecutionPlan {
                    prepare_snapshot: true,
                    restart: false,
                    result: false,
                },
            ),
            (
                LegacyMigrationRequestMode::Force,
                false,
                LegacyMigrationExecutionPlan {
                    prepare_snapshot: true,
                    restart: true,
                    result: true,
                },
            ),
        ] {
            assert_eq!(legacy_migration_execution_plan(mode, debug_build), expected);
        }
    }

    #[test]
    fn migration_rejects_a_running_legacy_process_unless_explicitly_allowed() {
        assert!(ensure_legacy_vrcx_process_state(false, true).is_err());
        assert!(ensure_legacy_vrcx_process_state(true, true).is_ok());
        assert!(ensure_legacy_vrcx_process_state(false, false).is_ok());
    }

    #[test]
    fn unavailable_reason_preserves_specific_and_fallback_messages() {
        let mut status = LegacyVrcxMigrationStatus::unavailable();
        assert_eq!(
            legacy_migration_unavailable_reason(&status),
            "Legacy VRCX migration is unavailable."
        );
        status.reason = Some("Unsupported database.".into());
        assert_eq!(
            legacy_migration_unavailable_reason(&status),
            "Unsupported database."
        );
    }
}
