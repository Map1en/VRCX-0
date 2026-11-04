use std::sync::Arc;

use vrcx_0_application::social::{
    MutualGraphFetchRuntime, MutualGraphFetchStartInput, MutualGraphFetchStatus,
};
use vrcx_0_contracts::feed::{FeedRowOutput, FeedRowsQueryInput};
use vrcx_0_contracts::social_aggregates as social;
use vrcx_0_contracts::FavoriteRow;
use vrcx_0_core::{FavoriteEntityKind, OwnerId};
use vrcx_0_mcp::{
    McpActivityQueryPort, McpChatboxPort, McpConfigPort, McpFavoritesQueryPort, McpFeedQueryPort,
    McpFriendCurrent, McpFriendLocalDataPort, McpFriendMemo, McpFuture, McpInterruptCheck,
    McpLocalModeration, McpMemoSave, McpMutualGraphMeta, McpMutualGraphPort, McpPlaySpan,
    McpScreenshotQueryPort, McpSocialHistoryQueryPort, McpWorldLookupPort,
};
use vrcx_0_persistence::{
    activity_page, config::ConfigRepository, favorites, friends, local_moderation, memos,
    social_aggregates, DatabaseService,
};

pub(crate) struct DesktopMcpConfigAdapter {
    config: ConfigRepository,
}

pub(crate) struct DesktopMcpScreenshotAdapter {
    db_path: std::path::PathBuf,
    photos_root: String,
    cache: std::sync::OnceLock<vrcx_0_persistence::screenshot_cache::MetadataCacheDb>,
}

impl DesktopMcpScreenshotAdapter {
    pub(crate) fn new(db_path: std::path::PathBuf, photos_root: String) -> Self {
        Self {
            db_path,
            photos_root,
            cache: std::sync::OnceLock::new(),
        }
    }

    fn cache(
        &self,
    ) -> vrcx_0_application_core::Result<&vrcx_0_persistence::screenshot_cache::MetadataCacheDb>
    {
        if let Some(cache) = self.cache.get() {
            return Ok(cache);
        }
        let cache = vrcx_0_persistence::screenshot_cache::MetadataCacheDb::new(&self.db_path)?;
        Ok(self.cache.get_or_init(|| cache))
    }
}

impl McpScreenshotQueryPort for DesktopMcpScreenshotAdapter {
    fn query(
        &self,
        filter: &vrcx_0_core::screenshots::ScreenshotFilter,
        limit: i64,
    ) -> vrcx_0_application_core::Result<vrcx_0_core::screenshots::ScreenshotQueryResult> {
        Ok(self
            .cache()?
            .query_screenshots_for_root(&self.photos_root, filter, Some(limit))?)
    }

    fn people(
        &self,
        filter: &vrcx_0_core::screenshots::ScreenshotFilter,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<vrcx_0_core::screenshots::ScreenshotFacet>> {
        Ok(self
            .cache()?
            .screenshot_people_for_root(&self.photos_root, filter, limit)?)
    }

    fn worlds(
        &self,
        filter: &vrcx_0_core::screenshots::ScreenshotFilter,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<vrcx_0_core::screenshots::ScreenshotFacet>> {
        Ok(self
            .cache()?
            .screenshot_worlds_for_root(&self.photos_root, filter, limit)?)
    }

    fn months(
        &self,
        filter: &vrcx_0_core::screenshots::ScreenshotFilter,
        utc_offset_minutes: i64,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<vrcx_0_core::screenshots::ScreenshotFacet>> {
        Ok(self.cache()?.screenshot_months_for_root(
            &self.photos_root,
            filter,
            utc_offset_minutes,
            limit,
        )?)
    }
}

pub(crate) struct DesktopMcpWorldLookupAdapter {
    web: Arc<vrcx_0_application_core::WebClient>,
    world_cache: Arc<vrcx_0_application_core::WorldCache>,
    auth_scope: vrcx_0_application_core::RuntimeAuthScope,
}

impl DesktopMcpWorldLookupAdapter {
    pub(crate) fn new(
        web: Arc<vrcx_0_application_core::WebClient>,
        world_cache: Arc<vrcx_0_application_core::WorldCache>,
        auth_scope: vrcx_0_application_core::RuntimeAuthScope,
    ) -> Self {
        Self {
            web,
            world_cache,
            auth_scope,
        }
    }
}

impl McpWorldLookupPort for DesktopMcpWorldLookupAdapter {
    fn world(
        &self,
        world_id: String,
    ) -> McpFuture<'_, vrcx_0_application_core::Result<Option<serde_json::Value>>> {
        Box::pin(async move {
            let endpoint = self.auth_scope.snapshot().endpoint;
            let response = self
                .world_cache
                .get(&self.web, &endpoint, &world_id, false, true)
                .await?;
            if !(200..=299).contains(&response.status) {
                return Err(vrcx_0_application_core::Error::Custom(format!(
                    "VRChat returned HTTP {}",
                    response.status
                )));
            }
            Ok(serde_json::from_str(&response.data).ok())
        })
    }
}

pub(crate) struct DesktopMcpMutualGraphAdapter {
    runtime: MutualGraphFetchRuntime,
    db: Arc<DatabaseService>,
    web: Arc<vrcx_0_application_core::WebClient>,
    auth_scope: vrcx_0_application_core::RuntimeAuthScope,
    tasks: vrcx_0_application_core::TaskSupervisor,
}

impl DesktopMcpMutualGraphAdapter {
    pub(crate) fn new(
        runtime: MutualGraphFetchRuntime,
        db: Arc<DatabaseService>,
        web: Arc<vrcx_0_application_core::WebClient>,
        auth_scope: vrcx_0_application_core::RuntimeAuthScope,
        tasks: vrcx_0_application_core::TaskSupervisor,
    ) -> Self {
        Self {
            runtime,
            db,
            web,
            auth_scope,
            tasks,
        }
    }
}

impl McpMutualGraphPort for DesktopMcpMutualGraphAdapter {
    fn status(&self) -> MutualGraphFetchStatus {
        self.runtime.status()
    }

    fn snapshot_meta(
        &self,
        owner_user_id: OwnerId,
    ) -> vrcx_0_application_core::Result<Vec<McpMutualGraphMeta>> {
        vrcx_0_persistence::mutual_graph::mutual_graph_snapshot_get(
            self.db.as_ref(),
            owner_user_id.to_string(),
        )
        .map(|snapshot| {
            snapshot
                .meta
                .into_iter()
                .map(|meta| McpMutualGraphMeta {
                    friend_id: meta.friend_id,
                    last_fetched_at: meta.last_fetched_at,
                    opted_out: meta.opted_out,
                    total_count: meta.total_count.map(|count| count as usize),
                })
                .collect()
        })
        .map_err(Into::into)
    }

    fn start(
        &self,
        input: MutualGraphFetchStartInput,
    ) -> vrcx_0_application_core::Result<MutualGraphFetchStatus> {
        self.runtime.start(
            input,
            Arc::new(vrcx_0_outbound_adapters::LocalMutualGraphStore::new(
                Arc::clone(&self.db),
            )),
            Arc::new(vrcx_0_outbound_adapters::VrchatMutualGraphRemoteRequests),
            Arc::new(vrcx_0_outbound_adapters::VrchatRequestAdapter::new(
                Arc::clone(&self.web),
            )),
            self.auth_scope.clone(),
            self.tasks.clone(),
        )
    }
}

impl DesktopMcpConfigAdapter {
    pub(crate) fn new(config: ConfigRepository) -> Self {
        Self { config }
    }
}

impl McpConfigPort for DesktopMcpConfigAdapter {
    fn get_bool(&self, key: &str, default: bool) -> vrcx_0_application_core::Result<bool> {
        self.config.get_bool(key, default).map_err(Into::into)
    }

    fn set_bool(&self, key: &str, value: bool) -> vrcx_0_application_core::Result<()> {
        self.config.set_bool(key, value).map_err(Into::into)
    }

    fn get_string(&self, key: &str, default: &str) -> vrcx_0_application_core::Result<String> {
        self.config.get_string(key, default).map_err(Into::into)
    }

    fn set_string(&self, key: &str, value: &str) -> vrcx_0_application_core::Result<()> {
        self.config.set_string(key, value).map_err(Into::into)
    }
}

pub(crate) struct DesktopMcpActivityQueryAdapter {
    db: Arc<DatabaseService>,
}

impl DesktopMcpActivityQueryAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpActivityQueryPort for DesktopMcpActivityQueryAdapter {
    fn copresence_summary(
        &self,
        input: social::CopresenceSummaryInput,
    ) -> vrcx_0_application_core::Result<social::CopresenceSummaryOutput> {
        social_aggregates::get_copresence_summary(self.db.as_ref(), input).map_err(Into::into)
    }

    fn friend_activity_pattern(
        &self,
        input: social::FriendActivityPatternInput,
    ) -> vrcx_0_application_core::Result<social::FriendActivityPatternOutput> {
        social_aggregates::get_friend_activity_pattern(self.db.as_ref(), input).map_err(Into::into)
    }

    fn search_worlds_visited(
        &self,
        owner_user_id: &OwnerId,
        input: social::SearchWorldsVisitedInput,
    ) -> vrcx_0_application_core::Result<social::SearchWorldsVisitedOutput> {
        social_aggregates::search_worlds_visited(self.db.as_ref(), owner_user_id, input)
            .map_err(Into::into)
    }

    fn top_visited_worlds(
        &self,
        owner_user_id: &OwnerId,
        input: social::TopVisitedWorldsInput,
    ) -> vrcx_0_application_core::Result<Vec<social::TopVisitedWorldRow>> {
        social_aggregates::top_visited_worlds(self.db.as_ref(), owner_user_id, input)
            .map_err(Into::into)
    }

    fn world_visit_history(
        &self,
        owner_user_id: &OwnerId,
        world_id: &str,
        recent_limit: i64,
    ) -> vrcx_0_application_core::Result<social::WorldVisitHistory> {
        social_aggregates::world_visit_history(
            self.db.as_ref(),
            owner_user_id,
            world_id,
            recent_limit,
        )
        .map_err(Into::into)
    }

    fn find_visited_worlds(
        &self,
        owner_user_id: &OwnerId,
        name: &str,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<social::VisitedWorldMatch>> {
        social_aggregates::find_visited_worlds(self.db.as_ref(), owner_user_id, name, limit)
            .map_err(Into::into)
    }

    fn fading_friends(
        &self,
        input: social::FadingFriendsInput,
    ) -> vrcx_0_application_core::Result<social::FadingFriendsOutput> {
        social_aggregates::get_fading_friends(self.db.as_ref(), input).map_err(Into::into)
    }

    fn best_time_to_play(
        &self,
        input: social::BestTimeToPlayInput,
    ) -> vrcx_0_application_core::Result<social::BestTimeToPlayOutput> {
        social_aggregates::get_best_time_to_play(self.db.as_ref(), input).map_err(Into::into)
    }

    fn recall_encounter(
        &self,
        input: social::RecallEncounterInput,
    ) -> vrcx_0_application_core::Result<social::RecallEncounterOutput> {
        social_aggregates::recall_encounter(self.db.as_ref(), input).map_err(Into::into)
    }

    fn visit_timeline(
        &self,
        input: social::VisitTimelineInput,
    ) -> vrcx_0_application_core::Result<social::VisitTimelineOutput> {
        social_aggregates::get_visit_timeline(self.db.as_ref(), input).map_err(Into::into)
    }

    fn friend_log(
        &self,
        input: social::FriendLogInput,
    ) -> vrcx_0_application_core::Result<social::FriendLogOutput> {
        social_aggregates::get_friend_log(self.db.as_ref(), input).map_err(Into::into)
    }

    fn play_spans(
        &self,
        owner_user_id: &OwnerId,
        from_ms: Option<i64>,
        to_ms: i64,
        open_location: Option<&str>,
    ) -> vrcx_0_application_core::Result<Vec<McpPlaySpan>> {
        activity_page::read_play_spans(
            self.db.as_ref(),
            owner_user_id,
            from_ms,
            to_ms,
            open_location,
        )
        .map(|spans| {
            spans
                .into_iter()
                .map(|span| McpPlaySpan {
                    start: span.start_ms,
                    end: span.end_ms,
                })
                .collect()
        })
        .map_err(Into::into)
    }
}

pub(crate) struct DesktopMcpSocialHistoryQueryAdapter {
    db: Arc<DatabaseService>,
}

impl DesktopMcpSocialHistoryQueryAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpSocialHistoryQueryPort for DesktopMcpSocialHistoryQueryAdapter {
    fn resolve_user(
        &self,
        input: social::ResolveUserInput,
    ) -> vrcx_0_application_core::Result<social::ResolveUserOutput> {
        social_aggregates::resolve_user_by_name(self.db.as_ref(), input).map_err(Into::into)
    }

    fn friend_changes(
        &self,
        input: social::FriendChangesInput,
    ) -> vrcx_0_application_core::Result<social::FriendChangesOutput> {
        social_aggregates::get_friend_changes(self.db.as_ref(), input).map_err(Into::into)
    }

    fn friend_log_first_created_at(
        &self,
        owner_user_id: &OwnerId,
        target_user_id: &str,
        kind: &str,
    ) -> vrcx_0_application_core::Result<Option<String>> {
        social_aggregates::get_friend_log_first_created_at(
            self.db.as_ref(),
            owner_user_id,
            target_user_id,
            kind,
        )
        .map_err(Into::into)
    }

    fn social_graph(
        &self,
        input: social::SocialGraphInput,
    ) -> vrcx_0_application_core::Result<social::SocialGraphOutput> {
        social_aggregates::get_social_graph(self.db.as_ref(), input).map_err(Into::into)
    }

    fn friend_circles(
        &self,
        input: social::FriendCirclesInput,
    ) -> vrcx_0_application_core::Result<social::FriendCirclesOutput> {
        social_aggregates::get_friend_circles(self.db.as_ref(), input).map_err(Into::into)
    }

    fn companions_of(
        &self,
        input: social::CompanionsOfInput,
    ) -> vrcx_0_application_core::Result<social::CompanionsOfOutput> {
        social_aggregates::get_companions_of(self.db.as_ref(), input).map_err(Into::into)
    }

    fn invite_history(
        &self,
        input: social::InviteHistoryInput,
    ) -> vrcx_0_application_core::Result<social::InviteHistoryOutput> {
        social_aggregates::get_invite_history(self.db.as_ref(), input).map_err(Into::into)
    }
}

pub(crate) struct DesktopMcpFriendLocalDataAdapter {
    db: Arc<DatabaseService>,
}

impl DesktopMcpFriendLocalDataAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpFriendLocalDataPort for DesktopMcpFriendLocalDataAdapter {
    fn memo_get_user(
        &self,
        user_id: String,
    ) -> vrcx_0_application_core::Result<Option<McpFriendMemo>> {
        memos::memo_get_user(self.db.as_ref(), user_id)
            .map(|row| row.map(friend_memo))
            .map_err(Into::into)
    }

    fn memo_list_users_page(
        &self,
        limit: i64,
        cursor: Option<(&str, &str)>,
    ) -> vrcx_0_application_core::Result<Vec<McpFriendMemo>> {
        memos::memo_list_users_page(self.db.as_ref(), limit, cursor)
            .map(|rows| rows.into_iter().map(friend_memo).collect())
            .map_err(Into::into)
    }

    fn memo_count_users(&self) -> vrcx_0_application_core::Result<usize> {
        memos::memo_count_users(self.db.as_ref()).map_err(Into::into)
    }

    fn friend_display_names(
        &self,
        owner_user_id: OwnerId,
        user_ids: &[String],
    ) -> vrcx_0_application_core::Result<std::collections::HashMap<String, String>> {
        friends::friend_display_names(self.db.as_ref(), owner_user_id, user_ids).map_err(Into::into)
    }

    fn memo_save_user(
        &self,
        user_id: String,
        memo: String,
    ) -> vrcx_0_application_core::Result<McpMemoSave> {
        memos::memo_save_user(self.db.as_ref(), user_id, memo)
            .map(|saved| McpMemoSave {
                entity_id: saved.entity_id,
                edited_at: saved.edited_at,
                memo: saved.memo,
            })
            .map_err(Into::into)
    }

    fn local_moderation_get(
        &self,
        owner_user_id: OwnerId,
        user_id: String,
    ) -> vrcx_0_application_core::Result<Option<McpLocalModeration>> {
        local_moderation::local_moderation_get(self.db.as_ref(), owner_user_id, user_id)
            .map(|row| {
                row.map(|row| McpLocalModeration {
                    user_id: row.user_id,
                    updated_at: row.updated_at,
                    display_name: row.display_name,
                    block: row.block,
                    mute: row.mute,
                })
            })
            .map_err(Into::into)
    }

    fn friend_current_list(
        &self,
        owner_user_id: OwnerId,
    ) -> vrcx_0_application_core::Result<Vec<McpFriendCurrent>> {
        friends::friend_log_current_list(self.db.as_ref(), owner_user_id.to_string())
            .map(|rows| {
                rows.into_iter()
                    .map(|row| McpFriendCurrent {
                        user_id: row.user_id,
                        display_name: row.display_name,
                        trust_level: row.trust_level,
                        friend_number: row.friend_number,
                    })
                    .collect()
            })
            .map_err(Into::into)
    }
}

fn friend_memo(row: memos::UserMemoOutput) -> McpFriendMemo {
    McpFriendMemo {
        user_id: row.user_id,
        edited_at: row.edited_at,
        memo: row.memo,
    }
}

pub(crate) struct DesktopMcpFavoritesQueryAdapter {
    db: Arc<DatabaseService>,
}

impl DesktopMcpFavoritesQueryAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpFavoritesQueryPort for DesktopMcpFavoritesQueryAdapter {
    fn favorite_list(
        &self,
        owner_user_id: &OwnerId,
        kind: FavoriteEntityKind,
    ) -> vrcx_0_application_core::Result<Vec<FavoriteRow>> {
        favorites::favorite_list(self.db.as_ref(), Some(owner_user_id), kind).map_err(Into::into)
    }
}

pub(crate) struct DesktopMcpFeedQueryAdapter {
    db: Arc<DatabaseService>,
}

impl DesktopMcpFeedQueryAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpFeedQueryPort for DesktopMcpFeedQueryAdapter {
    fn feed_rows_interruptible(
        &self,
        input: FeedRowsQueryInput,
        should_interrupt: McpInterruptCheck,
    ) -> vrcx_0_application_core::Result<Vec<FeedRowOutput>> {
        vrcx_0_persistence::feed::feed_rows_query_interruptible(
            self.db.as_ref(),
            input,
            move || should_interrupt(),
        )
        .map_err(Into::into)
    }
}

pub(crate) struct DesktopMcpChatboxAdapter {
    chatbox: Arc<crate::chatbox::ChatboxRuntime>,
}

impl DesktopMcpChatboxAdapter {
    pub(crate) fn new(chatbox: Arc<crate::chatbox::ChatboxRuntime>) -> Self {
        Self { chatbox }
    }
}

fn chatbox_json(
    value: impl serde::Serialize,
) -> vrcx_0_application_core::Result<serde_json::Value> {
    serde_json::to_value(value).map_err(vrcx_0_application_core::Error::Json)
}

impl McpChatboxPort for DesktopMcpChatboxAdapter {
    fn state(&self) -> vrcx_0_application_core::Result<serde_json::Value> {
        let editor = self.chatbox.editor_state();
        Ok(serde_json::json!({
            "status": self.chatbox.status(),
            "config": editor.config,
            "limits": editor.limits,
            "variables": editor.variables,
            "defaultFormats": editor.default_formats,
        }))
    }

    fn update_config(
        &self,
        config: serde_json::Value,
    ) -> vrcx_0_application_core::Result<serde_json::Value> {
        let config =
            serde_json::from_value(config).map_err(vrcx_0_application_core::Error::Json)?;
        chatbox_json(self.chatbox.set_config(config)?)
    }

    fn send(&self, text: String) -> vrcx_0_application_core::Result<serde_json::Value> {
        chatbox_json(self.chatbox.send_manual(&text)?)
    }

    fn set_afk(&self, afk: bool) -> vrcx_0_application_core::Result<serde_json::Value> {
        self.chatbox.set_manual_afk(afk);
        Ok(serde_json::json!({ "afk": afk }))
    }
}
