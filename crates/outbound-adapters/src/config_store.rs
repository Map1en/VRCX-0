use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application::profile::ProfileConfigStore;
use vrcx_0_application_core::{ConfigStore, Result};
use vrcx_0_contracts::{ConfigMutation, ConfigReadEntry, ConfigWriteEntry};
use vrcx_0_persistence::{config, storage::StorageService, DatabaseService};

pub struct LocalConfigStore {
    db: Arc<DatabaseService>,
    storage: Arc<StorageService>,
}

impl LocalConfigStore {
    pub fn new(db: Arc<DatabaseService>, storage: Arc<StorageService>) -> Self {
        Self { db, storage }
    }
}

impl ConfigStore for LocalConfigStore {
    fn get_raw(&self, key: &str) -> Result<Option<String>> {
        config::get_raw(&self.db, key).map_err(crate::Error::from)
    }

    fn get_bool(&self, key: &str, default: bool) -> Result<bool> {
        config::get_bool(&self.db, key, default).map_err(crate::Error::from)
    }

    fn get_string(&self, key: &str, default: &str) -> Result<String> {
        config::get_string(&self.db, key, default).map_err(crate::Error::from)
    }

    fn get_json(&self, key: &str, default: Value) -> Result<Value> {
        config::get_json(&self.db, key, default).map_err(crate::Error::from)
    }

    fn set_bool(&self, key: &str, value: bool) -> Result<()> {
        config::set_bool(&self.db, key, value).map_err(crate::Error::from)
    }

    fn set_string(&self, key: &str, value: &str) -> Result<()> {
        config::set_string(&self.db, key, value).map_err(crate::Error::from)
    }

    fn set_json(&self, key: &str, value: &Value) -> Result<()> {
        config::set_json(&self.db, key, value).map_err(crate::Error::from)
    }

    fn remove(&self, key: &str) -> Result<()> {
        config::remove(&self.db, key).map_err(crate::Error::from)
    }

    fn write_generation(&self) -> u64 {
        self.db.config_generation()
    }
}

impl ProfileConfigStore for LocalConfigStore {
    fn apply_mutations(&self, mutations: Vec<ConfigMutation>) -> Result<()> {
        config::config_apply_mutations(&self.db, &mutations).map_err(crate::Error::from)
    }

    fn list_values(&self) -> Result<Vec<ConfigReadEntry>> {
        config::config_list_values(&self.db).map_err(crate::Error::from)
    }

    fn set_values(&self, entries: Vec<ConfigWriteEntry>) -> Result<()> {
        config::config_set_values(&self.db, entries).map_err(crate::Error::from)
    }

    fn remove_value(&self, key: String) -> Result<i64> {
        config::config_remove_value(&self.db, key).map_err(crate::Error::from)
    }

    fn storage_get(&self, key: &str) -> Option<String> {
        self.storage.get(key)
    }

    fn storage_set(&self, key: String, value: String) {
        self.storage.set(key, value);
    }

    fn storage_save(&self) -> Result<()> {
        self.storage.save().map_err(crate::Error::from)
    }
}
