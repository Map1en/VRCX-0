use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::Value;

use vrcx_0_application::social::{MutualGraphFetchStartInput, MutualGraphFetchStatus};
use vrcx_0_contracts::feed::{FeedRowOutput, FeedRowsQueryInput};
use vrcx_0_contracts::social_aggregates as social;
use vrcx_0_contracts::FavoriteRow;
use vrcx_0_core::screenshots::{ScreenshotFacet, ScreenshotFilter, ScreenshotQueryResult};
use vrcx_0_core::FavoriteEntityKind;
use vrcx_0_core::OwnerId;

pub trait McpConfigPort: Send + Sync {
    fn get_bool(&self, key: &str, default: bool) -> vrcx_0_application_core::Result<bool>;

    fn set_bool(&self, key: &str, value: bool) -> vrcx_0_application_core::Result<()>;

    fn get_string(&self, key: &str, default: &str) -> vrcx_0_application_core::Result<String>;

    fn set_string(&self, key: &str, value: &str) -> vrcx_0_application_core::Result<()>;
}

pub type McpConfig = Arc<dyn McpConfigPort>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpPlaySpan {
    pub start: i64,
    pub end: i64,
}

pub trait McpActivityQueryPort: Send + Sync {
    fn copresence_summary(
        &self,
        input: social::CopresenceSummaryInput,
    ) -> vrcx_0_application_core::Result<social::CopresenceSummaryOutput>;

    fn friend_activity_pattern(
        &self,
        input: social::FriendActivityPatternInput,
    ) -> vrcx_0_application_core::Result<social::FriendActivityPatternOutput>;

    fn search_worlds_visited(
        &self,
        owner_user_id: &OwnerId,
        input: social::SearchWorldsVisitedInput,
    ) -> vrcx_0_application_core::Result<social::SearchWorldsVisitedOutput>;

    fn top_visited_worlds(
        &self,
        owner_user_id: &OwnerId,
        input: social::TopVisitedWorldsInput,
    ) -> vrcx_0_application_core::Result<Vec<social::TopVisitedWorldRow>>;

    fn world_visit_history(
        &self,
        owner_user_id: &OwnerId,
        world_id: &str,
        recent_limit: i64,
    ) -> vrcx_0_application_core::Result<social::WorldVisitHistory>;

    fn find_visited_worlds(
        &self,
        owner_user_id: &OwnerId,
        name: &str,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<social::VisitedWorldMatch>>;

    fn fading_friends(
        &self,
        input: social::FadingFriendsInput,
    ) -> vrcx_0_application_core::Result<social::FadingFriendsOutput>;

    fn best_time_to_play(
        &self,
        input: social::BestTimeToPlayInput,
    ) -> vrcx_0_application_core::Result<social::BestTimeToPlayOutput>;

    fn recall_encounter(
        &self,
        input: social::RecallEncounterInput,
    ) -> vrcx_0_application_core::Result<social::RecallEncounterOutput>;

    fn visit_timeline(
        &self,
        input: social::VisitTimelineInput,
    ) -> vrcx_0_application_core::Result<social::VisitTimelineOutput>;

    fn friend_log(
        &self,
        input: social::FriendLogInput,
    ) -> vrcx_0_application_core::Result<social::FriendLogOutput>;

    fn play_spans(
        &self,
        owner_user_id: &OwnerId,
        from_ms: Option<i64>,
        to_ms: i64,
        open_location: Option<&str>,
    ) -> vrcx_0_application_core::Result<Vec<McpPlaySpan>>;
}

pub type McpActivityQueries = Arc<dyn McpActivityQueryPort>;

pub trait McpSocialHistoryQueryPort: Send + Sync {
    fn resolve_user(
        &self,
        input: social::ResolveUserInput,
    ) -> vrcx_0_application_core::Result<social::ResolveUserOutput>;

    fn friend_changes(
        &self,
        input: social::FriendChangesInput,
    ) -> vrcx_0_application_core::Result<social::FriendChangesOutput>;

    fn friend_log_first_created_at(
        &self,
        owner_user_id: &OwnerId,
        target_user_id: &str,
        kind: &str,
    ) -> vrcx_0_application_core::Result<Option<String>>;

    fn social_graph(
        &self,
        input: social::SocialGraphInput,
    ) -> vrcx_0_application_core::Result<social::SocialGraphOutput>;

    fn friend_circles(
        &self,
        input: social::FriendCirclesInput,
    ) -> vrcx_0_application_core::Result<social::FriendCirclesOutput>;

    fn companions_of(
        &self,
        input: social::CompanionsOfInput,
    ) -> vrcx_0_application_core::Result<social::CompanionsOfOutput>;

    fn invite_history(
        &self,
        input: social::InviteHistoryInput,
    ) -> vrcx_0_application_core::Result<social::InviteHistoryOutput>;
}

pub type McpSocialHistoryQueries = Arc<dyn McpSocialHistoryQueryPort>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpFriendMemo {
    pub user_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpMemoSave {
    pub entity_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpFriendCurrent {
    pub user_id: String,
    pub display_name: String,
    pub trust_level: String,
    pub friend_number: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpLocalModeration {
    pub user_id: String,
    pub updated_at: String,
    pub display_name: String,
    pub block: bool,
    pub mute: bool,
}

pub trait McpFriendLocalDataPort: Send + Sync {
    fn memo_get_user(
        &self,
        user_id: String,
    ) -> vrcx_0_application_core::Result<Option<McpFriendMemo>>;

    fn memo_list_users_page(
        &self,
        limit: i64,
        cursor: Option<(&str, &str)>,
    ) -> vrcx_0_application_core::Result<Vec<McpFriendMemo>>;

    fn memo_count_users(&self) -> vrcx_0_application_core::Result<usize>;

    fn friend_display_names(
        &self,
        owner_user_id: OwnerId,
        user_ids: &[String],
    ) -> vrcx_0_application_core::Result<HashMap<String, String>>;

    fn memo_save_user(
        &self,
        user_id: String,
        memo: String,
    ) -> vrcx_0_application_core::Result<McpMemoSave>;

    fn local_moderation_get(
        &self,
        owner_user_id: OwnerId,
        user_id: String,
    ) -> vrcx_0_application_core::Result<Option<McpLocalModeration>>;

    fn friend_current_list(
        &self,
        owner_user_id: OwnerId,
    ) -> vrcx_0_application_core::Result<Vec<McpFriendCurrent>>;
}

pub type McpFriendLocalData = Arc<dyn McpFriendLocalDataPort>;

pub trait McpFavoritesQueryPort: Send + Sync {
    fn favorite_list(
        &self,
        owner_user_id: &OwnerId,
        kind: FavoriteEntityKind,
    ) -> vrcx_0_application_core::Result<Vec<FavoriteRow>>;
}

pub type McpFavoritesQueries = Arc<dyn McpFavoritesQueryPort>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpMutualGraphMeta {
    pub friend_id: String,
    pub last_fetched_at: String,
    pub opted_out: bool,
    pub total_count: Option<usize>,
}

pub trait McpMutualGraphPort: Send + Sync {
    fn status(&self) -> MutualGraphFetchStatus;

    fn snapshot_meta(
        &self,
        owner_user_id: OwnerId,
    ) -> vrcx_0_application_core::Result<Vec<McpMutualGraphMeta>>;

    fn start(
        &self,
        input: MutualGraphFetchStartInput,
    ) -> vrcx_0_application_core::Result<MutualGraphFetchStatus>;
}

pub type McpMutualGraph = Arc<dyn McpMutualGraphPort>;

pub type McpFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait McpWorldLookupPort: Send + Sync {
    fn world(
        &self,
        world_id: String,
    ) -> McpFuture<'_, vrcx_0_application_core::Result<Option<Value>>>;
}

pub type McpWorldLookup = Arc<dyn McpWorldLookupPort>;

pub trait McpScreenshotQueryPort: Send + Sync {
    fn query(
        &self,
        filter: &ScreenshotFilter,
        limit: i64,
    ) -> vrcx_0_application_core::Result<ScreenshotQueryResult>;

    fn people(
        &self,
        filter: &ScreenshotFilter,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<ScreenshotFacet>>;

    fn worlds(
        &self,
        filter: &ScreenshotFilter,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<ScreenshotFacet>>;

    fn months(
        &self,
        filter: &ScreenshotFilter,
        utc_offset_minutes: i64,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<ScreenshotFacet>>;
}

pub type McpScreenshotQueries = Arc<dyn McpScreenshotQueryPort>;

pub type McpInterruptCheck = Arc<dyn Fn() -> bool + Send + Sync>;

pub trait McpFeedQueryPort: Send + Sync {
    fn feed_rows_interruptible(
        &self,
        input: FeedRowsQueryInput,
        should_interrupt: McpInterruptCheck,
    ) -> vrcx_0_application_core::Result<Vec<FeedRowOutput>>;
}

pub type McpFeedQueries = Arc<dyn McpFeedQueryPort>;

pub trait McpChatboxPort: Send + Sync {
    fn state(&self) -> vrcx_0_application_core::Result<Value>;

    fn update_config(&self, config: Value) -> vrcx_0_application_core::Result<Value>;

    fn send(&self, text: String) -> vrcx_0_application_core::Result<Value>;

    fn set_afk(&self, afk: bool) -> vrcx_0_application_core::Result<Value>;
}

pub type McpChatbox = Arc<dyn McpChatboxPort>;
