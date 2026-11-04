use std::sync::Arc;

use vrcx_0_application_realtime::{
    FavoriteBaselineStore, FeedQueryStore, FriendLogStore, GameLogLookup, RealtimeBatchWriter,
    SocialMutationStore,
};
use vrcx_0_contracts::feed::{
    FeedLatestQueryInput, FeedLiveEntryInput, FeedReadModelOutput, FeedSearchQueryInput,
};
use vrcx_0_contracts::friend_log::{
    FriendLogCurrentEntryInput, FriendLogCurrentOutput, FriendLogDeleteOptionsInput,
    FriendLogHistoryEntryInput, FriendLogMutationResult, FriendLogReplaceOptionsInput,
    FriendLogUpsertOptionsInput,
};
use vrcx_0_contracts::realtime::{RealtimePersistenceBatch, RealtimeWriteCounts};
use vrcx_0_contracts::FavoriteRow;
use vrcx_0_core::{FavoriteEntityKind, OwnerId};
use vrcx_0_persistence::DatabaseService;

pub struct PersistenceRealtimeStore {
    db: Arc<DatabaseService>,
}

impl PersistenceRealtimeStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl GameLogLookup for PersistenceRealtimeStore {
    fn game_log_join_count(
        &self,
        owner: &OwnerId,
        user_id: &str,
        display_name: &str,
    ) -> crate::Result<i64> {
        let output = vrcx_0_persistence::game_log::game_log_query(
            &self.db,
            owner,
            vrcx_0_persistence::game_log::GameLogQuery::JoinCount {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
            },
        )?;
        Ok(match output {
            vrcx_0_persistence::game_log::GameLogQueryOutput::JoinCount(output) => {
                output.join_count
            }
            _ => 0,
        })
    }
    fn lookup_game_log_world_name(&self, world_id: &str) -> crate::Result<String> {
        Ok(vrcx_0_persistence::realtime::lookup_game_log_world_name(
            &self.db, world_id,
        )?)
    }
}

impl FavoriteBaselineStore for PersistenceRealtimeStore {
    fn favorite_list(
        &self,
        owner: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> crate::Result<Vec<FavoriteRow>> {
        Ok(vrcx_0_persistence::favorites::favorite_list(
            &self.db, owner, kind,
        )?)
    }
}

impl FriendLogStore for PersistenceRealtimeStore {
    fn friend_log_current_list(&self, user_id: &str) -> crate::Result<Vec<FriendLogCurrentOutput>> {
        Ok(vrcx_0_persistence::friends::friend_log_current_list(
            &self.db,
            user_id.to_string(),
        )?)
    }
    fn friend_log_replace_current(
        &self,
        user_id: &str,
        entries: Vec<FriendLogCurrentEntryInput>,
        options: FriendLogReplaceOptionsInput,
    ) -> crate::Result<FriendLogMutationResult> {
        Ok(vrcx_0_persistence::friends::friend_log_replace_current(
            &self.db,
            user_id.to_string(),
            entries,
            options,
        )?)
    }
}

impl SocialMutationStore for PersistenceRealtimeStore {
    fn delete_current_friend(
        &self,
        user_id: &str,
        target_user_ids: Vec<String>,
        options: FriendLogDeleteOptionsInput,
    ) -> crate::Result<FriendLogMutationResult> {
        Ok(
            vrcx_0_persistence::friends::friend_log_delete_current_array(
                &self.db,
                user_id.to_string(),
                target_user_ids,
                options,
            )?,
        )
    }
    fn upsert_current_friend(
        &self,
        user_id: &str,
        entry: FriendLogCurrentEntryInput,
        options: FriendLogUpsertOptionsInput,
    ) -> crate::Result<FriendLogMutationResult> {
        Ok(vrcx_0_persistence::friends::friend_log_upsert_current(
            &self.db,
            user_id.to_string(),
            entry,
            options,
        )?)
    }
    fn add_friend_history(
        &self,
        user_id: &str,
        entries: Vec<FriendLogHistoryEntryInput>,
    ) -> crate::Result<i64> {
        Ok(vrcx_0_persistence::friends::friend_log_history_add(
            &self.db,
            user_id.to_string(),
            entries,
        )?)
    }
    fn expire_notification(&self, user_id: &str, notification_id: &str) -> crate::Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_expire(
            &self.db,
            user_id.to_string(),
            notification_id.to_string(),
        )?)
    }
}

impl RealtimeBatchWriter for PersistenceRealtimeStore {
    fn write_realtime_batch(
        &self,
        owner: &OwnerId,
        batch: &RealtimePersistenceBatch,
    ) -> crate::Result<RealtimeWriteCounts> {
        Ok(vrcx_0_persistence::realtime::write_realtime_batch(
            &self.db, owner, batch,
        )?)
    }
}

impl FeedQueryStore for PersistenceRealtimeStore {
    fn feed_latest(
        &self,
        query: FeedLatestQueryInput,
        live_entries: Vec<FeedLiveEntryInput>,
        watermark: i64,
        include_persisted_rows: bool,
    ) -> crate::Result<FeedReadModelOutput> {
        Ok(vrcx_0_persistence::feed::feed_latest_query(
            &self.db,
            query,
            live_entries,
            watermark,
            include_persisted_rows,
        )?)
    }
    fn feed_search(
        &self,
        query: FeedSearchQueryInput,
        live_entries: Vec<FeedLiveEntryInput>,
        watermark: i64,
        include_persisted_rows: bool,
    ) -> crate::Result<FeedReadModelOutput> {
        Ok(vrcx_0_persistence::feed::feed_search_query(
            &self.db,
            query,
            live_entries,
            watermark,
            include_persisted_rows,
        )?)
    }
}
