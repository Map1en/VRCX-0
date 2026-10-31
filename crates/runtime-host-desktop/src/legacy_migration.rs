use std::sync::Arc;

pub use vrcx_0_contracts::{
    LegacyMigrationPaths, LegacyVrcxDiscovery, LegacyVrcxMigrationStatus, LegacyVrcxSource,
};

use crate::{DesktopDatabaseUpgradeRuntime, Result};

pub trait LegacyMigrationLifecycle: Send + Sync {
    fn stop_runtime_services(&self);
    fn request_restart(&self);
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
            vrcx_0_application_core::Error::Custom(legacy_migration_unavailable_reason(
                &unavailable_status,
            ))
        })?;
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
        .map_err(|error| {
            vrcx_0_application_core::Error::Custom(format!(
                "legacy VRCX discovery task failed: {error}"
            ))
            .into()
        })
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
        return Err(vrcx_0_application_core::Error::Custom(
            "VRCX is still running. Close it before migrating or explicitly allow migration while it is running."
                .into(),
        ).into());
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
