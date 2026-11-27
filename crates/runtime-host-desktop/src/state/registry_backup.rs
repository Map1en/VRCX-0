use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use crate::HostRegistryBackupActions;
use vrcx_0_application_game::{
    RegistryBackupExport, RegistryBackupMaintenanceMode, RegistryBackupMaintenanceResult,
    RegistryBackupSnapshot,
};
use vrcx_0_composition::Result;

use super::{
    run_coordinated_registry_backup_maintenance, DesktopRuntimeHostState,
    RegistryBackupMaintenanceState,
};

impl DesktopRuntimeHostState {
    pub fn acknowledge_registry_backup_restore_prompt(&self, backup_date: &str) -> Result<String> {
        let config = self.runtime.desktop_assembly().config_store();
        Ok(
            vrcx_0_application_game::registry_backup_restore_prompt_acknowledge(
                config.as_ref(),
                backup_date,
            )?,
        )
    }

    pub fn registry_backup(&self) -> RegistryBackupRuntime {
        RegistryBackupRuntime {
            config: self.runtime.desktop_assembly().config_store(),
            state: Arc::clone(&self.extension.registry_backup_state),
        }
    }
}

#[derive(Clone)]
pub struct RegistryBackupRuntime {
    config: Arc<dyn vrcx_0_application_core::ConfigStore>,
    state: Arc<Mutex<RegistryBackupMaintenanceState>>,
}

impl RegistryBackupRuntime {
    pub fn list(&self) -> Result<Vec<RegistryBackupSnapshot>> {
        self.with_store(|store| vrcx_0_application_game::registry_backup_list(store))
    }

    pub fn create(&self, name: &str) -> Result<Vec<RegistryBackupSnapshot>> {
        self.with_store(|store| {
            vrcx_0_application_game::registry_backup_create(store, &HostRegistryBackupActions, name)
        })
    }

    pub fn restore(&self, key: &str) -> Result<RegistryBackupSnapshot> {
        self.with_store(|store| {
            vrcx_0_application_game::registry_backup_restore(store, &HostRegistryBackupActions, key)
        })
    }

    pub fn delete(&self, key: &str) -> Result<Vec<RegistryBackupSnapshot>> {
        self.with_store(|store| vrcx_0_application_game::registry_backup_delete(store, key))
    }

    pub fn prepare_export(&self, key: &str) -> Result<RegistryBackupExport> {
        self.with_store(|store| vrcx_0_application_game::registry_backup_prepare_export(store, key))
    }

    pub fn import_from_file(&self, path: &Path) -> Result<()> {
        let json =
            vrcx_0_host_desktop::vrchat_registry::read_reg_json_file(&path.to_string_lossy())?;
        self.with_store(|store| {
            vrcx_0_application_game::registry_backup_import_json(
                store,
                &HostRegistryBackupActions,
                &json,
            )
        })
    }

    pub fn maintenance_run(
        &self,
        reason: &str,
        mode: RegistryBackupMaintenanceMode,
    ) -> Result<RegistryBackupMaintenanceResult> {
        let mut state = self.acquire_lock()?;
        let store = self.config.as_ref();
        Ok(run_coordinated_registry_backup_maintenance(
            &mut state,
            Instant::now(),
            mode,
            || {
                vrcx_0_application_game::registry_backup_maintenance_run(
                    store,
                    &HostRegistryBackupActions,
                    mode,
                    reason,
                )
            },
            || {
                vrcx_0_application_game::registry_backup_foreground_followup(
                    store,
                    &HostRegistryBackupActions,
                )
            },
        )?)
    }

    fn with_store<T>(
        &self,
        operation: impl FnOnce(
            &dyn vrcx_0_application_core::ConfigStore,
        ) -> vrcx_0_application_core::Result<T>,
    ) -> Result<T> {
        let _guard = self.acquire_lock()?;
        Ok(operation(self.config.as_ref())?)
    }

    fn acquire_lock(&self) -> Result<MutexGuard<'_, RegistryBackupMaintenanceState>> {
        self.state.lock().map_err(|error| {
            vrcx_0_application_core::Error::Custom(format!(
                "registry backup lock poisoned: {error}"
            ))
            .into()
        })
    }
}
