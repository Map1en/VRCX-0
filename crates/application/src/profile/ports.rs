use vrcx_0_application_core::{ConfigStore, Result};
use vrcx_0_contracts::{ConfigMutation, ConfigReadEntry, ConfigWriteEntry};

pub trait ProfileConfigStore: ConfigStore {
    fn apply_mutations(&self, mutations: Vec<ConfigMutation>) -> Result<()>;
    fn list_values(&self) -> Result<Vec<ConfigReadEntry>>;
    fn set_values(&self, entries: Vec<ConfigWriteEntry>) -> Result<()>;
    fn remove_value(&self, key: String) -> Result<i64>;
    fn storage_get(&self, key: &str) -> Option<String>;
    fn storage_set(&self, key: String, value: String);
    fn storage_save(&self) -> Result<()>;
}
