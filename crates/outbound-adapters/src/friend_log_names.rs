use std::{collections::HashMap, sync::Arc};

use vrcx_0_application::social::FriendLogNameStore;
use vrcx_0_contracts::game_log_query::{
    GameLogAllUserStatsOutput, GameLogQuery, GameLogQueryOutput,
};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::DatabaseService;

#[derive(Clone)]
pub struct LocalFriendLogNameStore {
    db: Arc<DatabaseService>,
}

impl LocalFriendLogNameStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl FriendLogNameStore for LocalFriendLogNameStore {
    fn friend_display_names(
        &self,
        owner_user_id: &OwnerId,
        user_ids: &[String],
    ) -> crate::Result<HashMap<String, String>> {
        vrcx_0_persistence::friends::friend_display_names(&self.db, owner_user_id.clone(), user_ids)
            .map_err(crate::Error::from)
    }

    fn game_log_user_stats(
        &self,
        owner_user_id: &OwnerId,
        user_ids: &[String],
    ) -> crate::Result<Vec<GameLogAllUserStatsOutput>> {
        let output = vrcx_0_persistence::game_log::game_log_query(
            &self.db,
            owner_user_id,
            GameLogQuery::AllUserStats {
                user_ids: user_ids.to_vec(),
                display_names: Vec::new(),
            },
        )?;
        match output {
            GameLogQueryOutput::AllUserStats(rows) => Ok(rows),
            _ => Ok(Vec::new()),
        }
    }
}
