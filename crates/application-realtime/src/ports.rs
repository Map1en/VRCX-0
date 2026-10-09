use std::path::PathBuf;

use serde_json::Value;
use vrcx_0_application_core::vrchat_api::VrchatApiRequest;
use vrcx_0_application_core::Result;
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

pub trait RealtimeStore: Send + Sync {
    fn database_path(&self) -> PathBuf;
    fn records_realtime_history(&self) -> bool {
        true
    }
    fn get_bool(&self, key: &str, default: bool) -> Result<bool>;
    fn get_string(&self, key: &str, default: &str) -> Result<String>;
    fn get_json(&self, key: &str, default: Value) -> Result<Value>;
    fn set_bool(&self, key: &str, value: bool) -> Result<()>;
    fn favorite_list(
        &self,
        owner: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>>;
    fn friend_log_current_list(&self, user_id: &str) -> Result<Vec<FriendLogCurrentOutput>>;
    fn friend_log_replace_current(
        &self,
        user_id: &str,
        entries: Vec<FriendLogCurrentEntryInput>,
        options: FriendLogReplaceOptionsInput,
    ) -> Result<FriendLogMutationResult>;
    fn friend_log_delete_current(
        &self,
        user_id: &str,
        target_user_ids: Vec<String>,
        options: FriendLogDeleteOptionsInput,
    ) -> Result<FriendLogMutationResult>;
    fn friend_log_upsert_current(
        &self,
        user_id: &str,
        entry: FriendLogCurrentEntryInput,
        options: FriendLogUpsertOptionsInput,
    ) -> Result<FriendLogMutationResult>;
    fn friend_log_history(
        &self,
        input: FriendLogHistoryQueryInput,
    ) -> Result<Vec<FriendLogHistoryOutput>>;
    fn friend_log_history_add(
        &self,
        user_id: &str,
        entries: Vec<FriendLogHistoryEntryInput>,
    ) -> Result<i64>;
    fn notification_expire(&self, user_id: &str, notification_id: &str) -> Result<()>;
    /// Durably stage a realtime batch before attempting to write it. Stores that do not need a
    /// restart-safe queue may keep the default no-op implementation.
    fn stage_realtime_batch(
        &self,
        _owner: &OwnerId,
        _batch: &RealtimePersistenceBatch,
    ) -> Result<()> {
        Ok(())
    }
    /// Whether a failed batch write is safe to retry. Remote transports must return false unless
    /// their write protocol provides a stable idempotency key for the batch.
    fn realtime_batch_retry_safe(&self) -> bool {
        true
    }
    fn write_realtime_batch(
        &self,
        owner: &OwnerId,
        batch: &RealtimePersistenceBatch,
    ) -> Result<RealtimeWriteCounts>;
    fn lookup_game_log_world_name(&self, world_id: &str) -> Result<String>;
    fn game_log_join_count(
        &self,
        owner: &OwnerId,
        user_id: &str,
        display_name: &str,
    ) -> Result<i64>;
    fn feed_latest(
        &self,
        query: FeedLatestQueryInput,
        live_entries: Vec<FeedLiveEntryInput>,
        watermark: i64,
        include_persisted_rows: bool,
    ) -> Result<FeedReadModelOutput>;
    fn feed_search(
        &self,
        query: FeedSearchQueryInput,
        live_entries: Vec<FeedLiveEntryInput>,
        watermark: i64,
        include_persisted_rows: bool,
    ) -> Result<FeedReadModelOutput>;
}

pub trait RealtimeRemoteRequests: Send + Sync {
    fn current_user(&self, endpoint: String) -> Result<VrchatApiRequest>;
    fn user(&self, endpoint: String, user_id: String) -> Result<(String, VrchatApiRequest)>;
    fn friend_status(
        &self,
        endpoint: String,
        user_id: String,
    ) -> Result<(String, VrchatApiRequest)>;
    fn favorite_limits(&self, endpoint: String) -> Result<VrchatApiRequest>;
    fn favorites(&self, endpoint: String, n: i32, offset: i32) -> Result<VrchatApiRequest>;
    fn favorite_groups(&self, endpoint: String, n: i32, offset: i32) -> Result<VrchatApiRequest>;
    fn friends(
        &self,
        endpoint: String,
        offline: bool,
        n: i32,
        offset: i32,
    ) -> Result<VrchatApiRequest>;
    fn world(&self, endpoint: String, world_id: String) -> Result<(String, VrchatApiRequest)>;
    fn invite_send(
        &self,
        endpoint: String,
        receiver_user_id: String,
        body: Value,
    ) -> Result<(String, VrchatApiRequest)>;
    fn notification_hide(
        &self,
        endpoint: String,
        notification_id: String,
        version: i64,
        notification_type: String,
        sender_user_id: String,
    ) -> Result<(String, VrchatApiRequest)>;
}
