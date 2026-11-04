use vrcx_0_application_core::{ConfigStore, MemoryConfigStore, Result};
use vrcx_0_contracts::{ConfigMutation, ConfigReadEntry, ConfigWriteEntry};

use super::ProfileConfigStore;

impl ProfileConfigStore for MemoryConfigStore {
    fn apply_mutations(&self, mutations: Vec<ConfigMutation>) -> Result<()> {
        for mutation in mutations {
            if let Some(value) = mutation.value {
                self.set_string(&mutation.key, &value)?;
            } else {
                self.remove(&mutation.key)?;
            }
        }
        Ok(())
    }

    fn list_values(&self) -> Result<Vec<ConfigReadEntry>> {
        Ok(self
            .entries()
            .into_iter()
            .map(|(key, value)| ConfigReadEntry { key, value })
            .collect())
    }

    fn set_values(&self, entries: Vec<ConfigWriteEntry>) -> Result<()> {
        for entry in entries {
            self.set_string(&entry.key, &entry.value)?;
        }
        Ok(())
    }

    fn remove_value(&self, key: String) -> Result<i64> {
        let existed = self.get_raw(&key)?.is_some();
        self.remove(&key)?;
        Ok(i64::from(existed))
    }

    fn storage_get(&self, _key: &str) -> Option<String> {
        None
    }

    fn storage_set(&self, _key: String, _value: String) {}

    fn storage_save(&self) -> Result<()> {
        Ok(())
    }
}
