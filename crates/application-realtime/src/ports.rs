use serde_json::Value;
use std::sync::Arc;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::feed::{
    FeedLatestQueryInput, FeedLiveEntryInput, FeedReadModelOutput, FeedSearchQueryInput,
};
use vrcx_0_contracts::friend_log::{
    FriendLogCurrentEntryInput, FriendLogCurrentOutput, FriendLogDeleteOptionsInput,
    FriendLogHistoryEntryInput, FriendLogMutationResult, FriendLogReplaceOptionsInput,
    FriendLogUpsertOptionsInput,
};
use vrcx_0_contracts::realtime::{RealtimePersistenceBatch, RealtimeWriteCounts};
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_contracts::FavoriteRow;
use vrcx_0_core::{FavoriteEntityKind, OwnerId};

pub trait RealtimeBatchWriter: Send + Sync {
    fn write_realtime_batch(
        &self,
        owner: &OwnerId,
        batch: &RealtimePersistenceBatch,
    ) -> Result<RealtimeWriteCounts>;
}

pub trait FriendLogStore: Send + Sync {
    fn friend_log_current_list(&self, user_id: &str) -> Result<Vec<FriendLogCurrentOutput>>;
    fn friend_log_replace_current(
        &self,
        user_id: &str,
        entries: Vec<FriendLogCurrentEntryInput>,
        options: FriendLogReplaceOptionsInput,
    ) -> Result<FriendLogMutationResult>;
}

pub trait FavoriteBaselineStore: Send + Sync {
    fn favorite_list(
        &self,
        owner: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>>;
}

pub trait GameLogLookup: Send + Sync {
    fn lookup_game_log_world_name(&self, world_id: &str) -> Result<String>;
    fn game_log_join_count(
        &self,
        owner: &OwnerId,
        user_id: &str,
        display_name: &str,
    ) -> Result<i64>;
}

pub trait FeedQueryStore: Send + Sync {
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

pub trait SocialMutationStore: Send + Sync {
    fn delete_current_friend(
        &self,
        owner_user_id: &str,
        target_user_ids: Vec<String>,
        options: FriendLogDeleteOptionsInput,
    ) -> Result<FriendLogMutationResult>;
    fn upsert_current_friend(
        &self,
        owner_user_id: &str,
        entry: FriendLogCurrentEntryInput,
        options: FriendLogUpsertOptionsInput,
    ) -> Result<FriendLogMutationResult>;
    fn add_friend_history(
        &self,
        owner_user_id: &str,
        entries: Vec<FriendLogHistoryEntryInput>,
    ) -> Result<i64>;
    fn expire_notification(&self, owner_user_id: &str, notification_id: &str) -> Result<()>;
}

#[derive(Clone)]
pub struct RealtimeStores {
    pub batch_writer: Arc<dyn RealtimeBatchWriter>,
    pub friend_log: Arc<dyn FriendLogStore>,
    pub favorites: Arc<dyn FavoriteBaselineStore>,
    pub game_log: Arc<dyn GameLogLookup>,
    pub feed: Arc<dyn FeedQueryStore>,
}

impl RealtimeStores {
    pub fn shared<T>(store: Arc<T>) -> Self
    where
        T: RealtimeBatchWriter
            + FriendLogStore
            + FavoriteBaselineStore
            + GameLogLookup
            + FeedQueryStore
            + 'static,
    {
        Self {
            batch_writer: store.clone(),
            friend_log: store.clone(),
            favorites: store.clone(),
            game_log: store.clone(),
            feed: store,
        }
    }
}

pub trait RealtimeRemoteRequests: Send + Sync {
    fn current_user(&self, endpoint: String) -> Result<VrchatRequest>;
    fn user(&self, endpoint: String, user_id: String) -> Result<(String, VrchatRequest)>;
    fn friend_status(&self, endpoint: String, user_id: String) -> Result<(String, VrchatRequest)>;
    fn favorite_limits(&self, endpoint: String) -> Result<VrchatRequest>;
    fn favorites(&self, endpoint: String, n: i32, offset: i32) -> Result<VrchatRequest>;
    fn favorite_groups(&self, endpoint: String, n: i32, offset: i32) -> Result<VrchatRequest>;
    fn friends(
        &self,
        endpoint: String,
        offline: bool,
        n: i32,
        offset: i32,
    ) -> Result<VrchatRequest>;
    fn world(&self, endpoint: String, world_id: String) -> Result<(String, VrchatRequest)>;
    fn group(&self, endpoint: String, group_id: String) -> Result<VrchatRequest>;
    fn invite_send(
        &self,
        endpoint: String,
        receiver_user_id: String,
        body: Value,
    ) -> Result<(String, VrchatRequest)>;
    fn notification_hide(
        &self,
        endpoint: String,
        notification_id: String,
        version: i64,
        notification_type: String,
        sender_user_id: String,
    ) -> Result<(String, VrchatRequest)>;
}
