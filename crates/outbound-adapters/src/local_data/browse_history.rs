use vrcx_0_contracts::browse_history::{
    BrowseHistoryEntityKind, BrowseHistoryPageOutput, BrowseHistoryQueryInput,
    BrowseHistoryRecordInput,
};
use vrcx_0_core::OwnerId;

use super::LocalDataStore;
use crate::Result;

impl LocalDataStore {
    pub fn browse_history_record(&self, input: BrowseHistoryRecordInput) -> Result<()> {
        Ok(vrcx_0_persistence::browse_history::browse_history_record(
            self.db.as_ref(),
            input,
        )?)
    }

    pub fn browse_history_query(
        &self,
        input: BrowseHistoryQueryInput,
    ) -> Result<BrowseHistoryPageOutput> {
        Ok(vrcx_0_persistence::browse_history::browse_history_query(
            self.db.as_ref(),
            input,
        )?)
    }

    pub fn browse_history_delete(
        &self,
        owner_user_id: OwnerId,
        entity_kind: BrowseHistoryEntityKind,
        entity_id: String,
    ) -> Result<i64> {
        Ok(vrcx_0_persistence::browse_history::browse_history_delete(
            self.db.as_ref(),
            owner_user_id,
            entity_kind,
            entity_id,
        )?)
    }

    pub fn browse_history_clear(
        &self,
        owner_user_id: OwnerId,
        entity_kind: Option<BrowseHistoryEntityKind>,
    ) -> Result<i64> {
        Ok(vrcx_0_persistence::browse_history::browse_history_clear(
            self.db.as_ref(),
            owner_user_id,
            entity_kind,
        )?)
    }

    pub fn browse_history_retention_days_get(&self) -> Result<i64> {
        Ok(
            vrcx_0_persistence::browse_history::browse_history_retention_days_get(
                self.db.as_ref(),
            )?,
        )
    }

    pub fn browse_history_retention_days_set(&self, retention_days: i64) -> Result<i64> {
        Ok(
            vrcx_0_persistence::browse_history::browse_history_retention_days_set(
                self.db.as_ref(),
                retention_days,
            )?,
        )
    }
}
