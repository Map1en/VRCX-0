use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application_realtime::RealtimeStore;
use vrcx_0_contracts::feed::{
    FeedLatestQueryInput, FeedLiveEntryInput, FeedReadModelOutput, FeedSearchQueryInput,
};
use vrcx_0_contracts::friend_log::{
    FriendLogCurrentEntryInput, FriendLogCurrentOutput, FriendLogDeleteOptionsInput,
    FriendLogHistoryEntryInput, FriendLogHistoryOutput, FriendLogHistoryQueryInput,
    FriendLogMutationResult, FriendLogReplaceOptionsInput, FriendLogUpsertOptionsInput,
};
use vrcx_0_contracts::realtime::{RealtimePersistenceBatch, RealtimeWriteCounts};
use vrcx_0_contracts::FavoriteRow;
use vrcx_0_core::{FavoriteEntityKind, OwnerId};
use vrcx_0_persistence::DatabaseService;

pub struct PersistenceRealtimeStore {
    db: Arc<DatabaseService>,
    headless_journal: Option<Arc<super::realtime_journal::RealtimeJournal>>,
}

impl PersistenceRealtimeStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self {
            db,
            headless_journal: None,
        }
    }

    pub fn new_headless(db: Arc<DatabaseService>) -> crate::Result<Self> {
        let headless_journal = Some(super::realtime_journal::RealtimeJournal::open(Arc::clone(
            &db,
        ))?);
        Ok(Self {
            db,
            headless_journal,
        })
    }
}

impl RealtimeStore for PersistenceRealtimeStore {
    fn records_realtime_history(&self) -> bool {
        !self.db.is_remote()
    }
    fn stage_realtime_batch(
        &self,
        owner: &OwnerId,
        batch: &RealtimePersistenceBatch,
    ) -> crate::Result<()> {
        if let Some(journal) = &self.headless_journal {
            return journal.stage(owner, batch);
        }
        Ok(())
    }
    fn database_path(&self) -> std::path::PathBuf {
        self.db.db_path().to_path_buf()
    }
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
    fn get_bool(&self, key: &str, default: bool) -> crate::Result<bool> {
        Ok(vrcx_0_persistence::config::get_bool(
            &self.db, key, default,
        )?)
    }
    fn get_string(&self, key: &str, default: &str) -> crate::Result<String> {
        Ok(vrcx_0_persistence::config::get_string(
            &self.db, key, default,
        )?)
    }
    fn get_json(&self, key: &str, default: Value) -> crate::Result<Value> {
        Ok(vrcx_0_persistence::config::get_json(
            &self.db, key, default,
        )?)
    }
    fn set_bool(&self, key: &str, value: bool) -> crate::Result<()> {
        Ok(vrcx_0_persistence::config::set_bool(&self.db, key, value)?)
    }
    fn favorite_list(
        &self,
        owner: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> crate::Result<Vec<FavoriteRow>> {
        Ok(vrcx_0_persistence::favorites::favorite_list(
            &self.db, owner, kind,
        )?)
    }
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
        if self.db.is_remote() {
            return Ok(FriendLogMutationResult {
                user_id: user_id.to_owned(),
                target_user_id: String::new(),
                count: 0,
                inserted: None,
                history_count: 0,
            });
        }
        Ok(vrcx_0_persistence::friends::friend_log_replace_current(
            &self.db,
            user_id.to_string(),
            entries,
            options,
        )?)
    }
    fn friend_log_delete_current(
        &self,
        user_id: &str,
        target_user_ids: Vec<String>,
        options: FriendLogDeleteOptionsInput,
    ) -> crate::Result<FriendLogMutationResult> {
        if self.db.is_remote() {
            return Ok(FriendLogMutationResult {
                user_id: user_id.to_owned(),
                target_user_id: String::new(),
                count: 0,
                inserted: None,
                history_count: 0,
            });
        }
        Ok(
            vrcx_0_persistence::friends::friend_log_delete_current_array(
                &self.db,
                user_id.to_string(),
                target_user_ids,
                options,
            )?,
        )
    }
    fn friend_log_upsert_current(
        &self,
        user_id: &str,
        entry: FriendLogCurrentEntryInput,
        options: FriendLogUpsertOptionsInput,
    ) -> crate::Result<FriendLogMutationResult> {
        if self.db.is_remote() {
            return Ok(FriendLogMutationResult {
                user_id: user_id.to_owned(),
                target_user_id: entry.user_id.clone(),
                count: 0,
                inserted: Some(false),
                history_count: 0,
            });
        }
        Ok(vrcx_0_persistence::friends::friend_log_upsert_current(
            &self.db,
            user_id.to_string(),
            entry,
            options,
        )?)
    }
    fn friend_log_history(
        &self,
        input: FriendLogHistoryQueryInput,
    ) -> crate::Result<Vec<FriendLogHistoryOutput>> {
        Ok(vrcx_0_persistence::friends::friend_log_history_query(
            &self.db, input,
        )?)
    }
    fn friend_log_history_add(
        &self,
        user_id: &str,
        entries: Vec<FriendLogHistoryEntryInput>,
    ) -> crate::Result<i64> {
        if self.db.is_remote() {
            return Ok(0);
        }
        Ok(vrcx_0_persistence::friends::friend_log_history_add(
            &self.db,
            user_id.to_string(),
            entries,
        )?)
    }
    fn notification_expire(&self, user_id: &str, notification_id: &str) -> crate::Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_expire(
            &self.db,
            user_id.to_string(),
            notification_id.to_string(),
        )?)
    }
    fn write_realtime_batch(
        &self,
        owner: &OwnerId,
        batch: &RealtimePersistenceBatch,
    ) -> crate::Result<RealtimeWriteCounts> {
        if self.db.is_remote() {
            // The server records API activity. Only observations requiring a running
            // game are supplied by the desktop, so there is no history reconciliation.
            let local_game = RealtimePersistenceBatch {
                game_log_locations: batch.game_log_locations.clone(),
                game_log_location_time_updates: batch.game_log_location_time_updates.clone(),
                avatar_history_upserts: batch.avatar_history_upserts.clone(),
                avatar_time_spent_upserts: batch.avatar_time_spent_upserts.clone(),
                ..Default::default()
            };
            if local_game.is_empty() {
                return Ok(RealtimeWriteCounts::default());
            }
            let batch_id = super::realtime_journal::batch_id(owner, &local_game)?;
            return Ok(vrcx_0_persistence::realtime::write_realtime_batch_once(
                &self.db,
                owner,
                &local_game,
                &batch_id,
            )?);
        }
        if let Some(journal) = &self.headless_journal {
            return Ok(journal.write_and_drain(owner, batch)?);
        }
        Ok(vrcx_0_persistence::realtime::write_realtime_batch(
            &self.db, owner, batch,
        )?)
    }
    fn lookup_game_log_world_name(&self, world_id: &str) -> crate::Result<String> {
        Ok(vrcx_0_persistence::realtime::lookup_game_log_world_name(
            &self.db, world_id,
        )?)
    }
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
