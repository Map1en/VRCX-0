use std::sync::Arc;

use vrcx_0_application::social::{
    LocalModerationInput, LocalModerationOutput, ModerationSyncRemoteRequests, ModerationSyncStore,
    RemoteModerationInput,
};
use vrcx_0_application_core::{vrchat_api::VrchatApiRequest, Result};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::{local_moderation, DatabaseService};
use vrcx_0_vrchat_client::moderation::{
    player_moderation_update_input, player_moderations_get_input,
};

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

#[derive(Clone)]
pub struct VrchatModerationSyncRemoteRequests;

impl ModerationSyncRemoteRequests for VrchatModerationSyncRemoteRequests {
    fn list(&self, endpoint: String) -> Result<VrchatApiRequest> {
        Ok(player_moderations_get_input(endpoint))
    }

    fn update(
        &self,
        endpoint: String,
        enabled: bool,
        target_user_id: String,
        moderation_type: String,
    ) -> Result<VrchatApiRequest> {
        Ok(player_moderation_update_input(
            endpoint,
            enabled,
            target_user_id,
            moderation_type,
        ))
    }
}
