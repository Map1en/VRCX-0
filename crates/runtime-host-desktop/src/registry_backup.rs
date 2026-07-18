use serde_json::Value;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_application_game::RegistryBackupHostActions;

pub struct HostRegistryBackupActions;

impl RegistryBackupHostActions for HostRegistryBackupActions {
    fn has_registry_folder(&self) -> Result<bool> {
        vrcx_0_host_desktop::vrchat_registry::has_registry_folder()
            .map_err(host_error_to_application)
    }

    fn get_registry(&self) -> Result<Value> {
        let registry = vrcx_0_host_desktop::vrchat_registry::get_registry()
            .map_err(host_error_to_application)?;
        serde_json::to_value(registry).map_err(Error::from)
    }

    fn set_registry_json(&self, json: &str) -> Result<()> {
        vrcx_0_host_desktop::vrchat_registry::set_registry(json).map_err(host_error_to_application)
    }
}

fn host_error_to_application(error: vrcx_0_host::Error) -> Error {
    match error {
        vrcx_0_host::Error::Io(error) => Error::Io(error),
        vrcx_0_host::Error::Json(error) => Error::Json(error),
        vrcx_0_host::Error::Custom(message) => Error::Custom(message),
    }
}
