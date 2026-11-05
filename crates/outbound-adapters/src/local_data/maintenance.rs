use vrcx_0_contracts::database_maintenance::{MaintenanceTableSizesOutput, UserTableContextOutput};

use super::LocalDataStore;
use crate::Result;

impl LocalDataStore {
    pub fn maintenance_table_sizes(&self, user_id: String) -> Result<MaintenanceTableSizesOutput> {
        Ok(
            vrcx_0_persistence::maintenance::database_maintenance_table_sizes_get(
                self.db.as_ref(),
                user_id,
            )?,
        )
    }

    pub fn ensure_user_tables(&self, user_id: String) -> Result<UserTableContextOutput> {
        Ok(vrcx_0_persistence::maintenance::user_tables_ensure(
            self.db.as_ref(),
            user_id,
        )?)
    }
}
