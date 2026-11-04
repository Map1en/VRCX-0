use std::sync::Arc;

use vrcx_0_application::social::{
    LocalModerationInput, LocalModerationOutput, ModerationSyncStore, RemoteModerationInput,
};
use vrcx_0_application_core::Result;
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::{local_moderation, DatabaseService};

#[derive(Clone)]
pub struct LocalModerationSyncStore {
    db: Arc<DatabaseService>,
}

impl LocalModerationSyncStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl ModerationSyncStore for LocalModerationSyncStore {
    fn sync_snapshot(
        &self,
        owner: OwnerId,
        rows: Vec<RemoteModerationInput>,
    ) -> Result<Vec<LocalModerationOutput>> {
        local_moderation::local_moderation_sync_snapshot(&self.db, owner, rows)
            .map_err(crate::Error::from)
    }

    fn get(&self, owner: OwnerId, user_id: String) -> Result<Option<LocalModerationOutput>> {
        local_moderation::local_moderation_get(&self.db, owner, user_id).map_err(crate::Error::from)
    }

    fn set(&self, owner: OwnerId, entry: LocalModerationInput) -> Result<()> {
        local_moderation::local_moderation_set(&self.db, owner, entry).map_err(crate::Error::from)
    }

    fn delete(&self, owner: OwnerId, user_id: String) -> Result<()> {
        local_moderation::local_moderation_delete(&self.db, owner, user_id)
            .map_err(crate::Error::from)
    }
}
