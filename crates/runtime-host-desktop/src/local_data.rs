use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application::avatars::AvatarFeedCleanupOutcome;
use vrcx_0_application::favorites::{
    FavoriteMutationCoordinator, FavoriteRow, LocalFavoriteSnapshot,
};
use vrcx_0_application::social::{
    get_user_mutual_friends_list, refresh_mutual_graph_friend, MutualGraphFetchCancelInput,
    MutualGraphFetchRuntime, MutualGraphFetchStartInput, MutualGraphFetchStatus,
    MutualGraphFriendRefreshInput, MutualGraphFriendRefreshOutput, MutualGraphRequestDeps,
    UserMutualFriendsListInput, UserMutualFriendsListOutput,
};
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
use vrcx_0_application_core::{
    AvatarCache, FavoriteEntityKind, Result, RuntimeAuthScope, TaskSupervisor, WebClient,
    WorldCache,
};
use vrcx_0_application_game::{
    GameLogSessionDto, GameLogSessionsQueryInput, InstanceHistoryEntryOutput,
    InstanceHistoryQueryInput, PlayerListSnapshotOutput,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_contracts::{
    SavedGroupCollectionCreateInput, SavedGroupCollectionDeleteInput, SavedGroupFavoriteAddInput,
    SavedGroupFavoriteRemoveInput, SavedGroupFavoritesSnapshot,
};
use vrcx_0_core::json::RawJson;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_core::vrchat_ids::is_group_id;
use vrcx_0_persistence::DatabaseService;

pub use vrcx_0_core::OwnerId;
pub use vrcx_0_persistence::activity::{
    ActivityOverlapViewBuildInput, ActivityOverlapViewOutput, ActivityViewBuildInput,
    ActivityViewOutput,
};
pub use vrcx_0_persistence::activity_page::{ActivityPageBuildInput, ActivityPageView};
pub use vrcx_0_persistence::avatars::{
    AvatarCacheOutput, AvatarTagInput, AvatarTagOutput, AvatarTagsPatchInput,
    AvatarTimeSpentOutput, AvatarUsageRow,
};
pub use vrcx_0_persistence::browse_history::{
    BrowseHistoryEntityKind, BrowseHistoryPageOutput, BrowseHistoryQueryInput,
    BrowseHistoryRecordInput,
};
pub use vrcx_0_persistence::config::{ConfigReadEntry, ConfigWriteEntry};
pub use vrcx_0_persistence::feed::{
    FeedLatestQueryInput, FeedReadModelOutput, FeedRowOutput, FeedRowsQueryInput,
    FeedSearchQueryInput,
};
pub use vrcx_0_persistence::friends::{
    FriendLogCurrentOutput, FriendLogHistoryEntryInput, FriendLogHistoryOutput,
    FriendLogHistoryQueryInput,
};
pub use vrcx_0_persistence::game_log::{
    GameLogEntryDeleteKind, GameLogPreviousInstanceGroupOutput, GameLogPreviousInstanceWorldOutput,
    GameLogQuery, GameLogQueryOutput, GameLogWriteKind,
};
pub use vrcx_0_persistence::local_moderation::LocalModerationOutput;
pub use vrcx_0_persistence::maintenance::{
    BrokenGameLogDisplayNameOutput, MaintenanceTableSizesOutput, UserTableContextOutput,
};
pub use vrcx_0_persistence::memos::{
    AvatarMemoOutput, MemoSaveResult, UserMemoOutput, UserNoteOutput, WorldMemoOutput,
};
pub use vrcx_0_persistence::mutual_graph::MutualGraphSnapshotOutput;
pub use vrcx_0_persistence::notifications::{
    NotificationListItemOutput, NotificationListQueryInput,
};
pub use vrcx_0_persistence::player_list::InstanceActivityRowOutput;
pub use vrcx_0_persistence::social_aggregates::{WorldFriendVisitRow, WorldFriendVisitsOutput};
pub use vrcx_0_persistence::worlds::WorldSummaryOutput;

#[derive(Debug, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarGetInput {
    pub avatar_id: String,
    #[serde(default)]
    pub full: bool,
    #[serde(default)]
    pub fresh: bool,
}

#[derive(Debug, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldGetInput {
    #[serde(default)]
    pub world_id: String,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub full: bool,
}

#[derive(Clone)]
pub struct LocalDataRuntime {
    db: Arc<DatabaseService>,
    profile_config: Arc<dyn vrcx_0_application::profile::ProfileConfigStore>,
    web: Arc<WebClient>,
    auth_scope: RuntimeAuthScope,
    tasks: TaskSupervisor,
    avatar_cache: Arc<AvatarCache>,
    world_cache: Arc<WorldCache>,
    realtime: Arc<RealtimeHostRuntime>,
    favorite_mutations: FavoriteMutationCoordinator,
    mutual_graph_fetch: MutualGraphFetchRuntime,
    mutual_graph_store: Arc<vrcx_0_outbound_adapters::LocalMutualGraphStore>,
    mutual_graph_remote_requests: Arc<vrcx_0_outbound_adapters::VrchatMutualGraphRemoteRequests>,
    mutual_graph_remote: Arc<vrcx_0_outbound_adapters::VrchatRequestAdapter>,
}

impl LocalDataRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: Arc<DatabaseService>,
        profile_config: Arc<dyn vrcx_0_application::profile::ProfileConfigStore>,
        web: Arc<WebClient>,
        auth_scope: RuntimeAuthScope,
        tasks: TaskSupervisor,
        avatar_cache: Arc<AvatarCache>,
        world_cache: Arc<WorldCache>,
        realtime: Arc<RealtimeHostRuntime>,
        favorite_mutations: FavoriteMutationCoordinator,
        mutual_graph_fetch: MutualGraphFetchRuntime,
    ) -> Self {
        let mutual_graph_store = Arc::new(vrcx_0_outbound_adapters::LocalMutualGraphStore::new(
            Arc::clone(&db),
        ));
        let mutual_graph_remote = Arc::new(vrcx_0_outbound_adapters::VrchatRequestAdapter::new(
            Arc::clone(&web),
        ));
        Self {
            db,
            profile_config,
            web,
            auth_scope,
            tasks,
            avatar_cache,
            world_cache,
            realtime,
            favorite_mutations,
            mutual_graph_fetch,
            mutual_graph_store,
            mutual_graph_remote_requests: Arc::new(
                vrcx_0_outbound_adapters::VrchatMutualGraphRemoteRequests,
            ),
            mutual_graph_remote,
        }
    }

    fn current_owner(&self) -> OwnerId {
        OwnerId::new(self.auth_scope.snapshot().current_user_id)
    }

    fn saved_group_owner(&self) -> Result<OwnerId> {
        let scope = self.auth_scope.snapshot();
        if !scope.active {
            return Err(vrcx_0_application_core::Error::Custom(
                "Saved group favorites require an authenticated session.".into(),
            ));
        }
        Ok(OwnerId::new(scope.current_user_id))
    }

    fn game_state_store(&self) -> crate::game_state_store::PersistenceGameStateStore {
        crate::game_state_store::PersistenceGameStateStore::new(Arc::clone(&self.db))
    }

    pub async fn avatar_get(&self, input: AvatarGetInput) -> Result<Option<RawJson>> {
        let auth_scope = self.auth_scope.snapshot();
        let endpoint = if auth_scope.endpoint.is_empty() {
            VRCHAT_API_DEFAULT_ENDPOINT
        } else {
            auth_scope.endpoint.as_str()
        };
        self.avatar_cache
            .resolve(
                self.web.as_ref(),
                &auth_scope.current_user_id,
                endpoint,
                &input.avatar_id,
                input.full,
                input.fresh,
            )
            .await
            .map(|avatar| avatar.map(|value| RawJson::from(value.as_ref().clone())))
    }

    pub fn avatar_find_by_image_url(&self, image_url: String) -> Result<Option<RawJson>> {
        let auth_scope = self.auth_scope.snapshot();
        let endpoint = if auth_scope.endpoint.is_empty() {
            VRCHAT_API_DEFAULT_ENDPOINT
        } else {
            auth_scope.endpoint.as_str()
        };
        self.avatar_cache
            .find_by_image_url(&auth_scope.current_user_id, endpoint, &image_url)
            .map(|avatar| avatar.map(|value| RawJson::from(value.as_ref().clone())))
    }

    pub async fn world_get(&self, input: WorldGetInput) -> Result<VrchatApiResponse> {
        let auth_scope = self.auth_scope.snapshot();
        let endpoint = if auth_scope.endpoint.is_empty() {
            VRCHAT_API_DEFAULT_ENDPOINT
        } else {
            auth_scope.endpoint.as_str()
        };
        self.world_cache
            .get(
                self.web.as_ref(),
                endpoint,
                &input.world_id,
                input.force,
                input.full,
            )
            .await
    }

    pub fn set_feed_persistence_disabled(&self, disabled: bool) -> Result<()> {
        self.realtime.set_feed_persistence_disabled(disabled)
    }

    pub fn set_avatar_feed_persistence_disabled(&self, disabled: bool) -> Result<()> {
        self.realtime.set_avatar_feed_persistence_disabled(disabled)
    }

    pub fn query_feed_latest(&self, query: FeedLatestQueryInput) -> Result<FeedReadModelOutput> {
        self.realtime.query_feed_latest(query)
    }

    pub fn query_feed_search(&self, query: FeedSearchQueryInput) -> Result<Vec<FeedRowOutput>> {
        self.realtime.query_feed_search(query)
    }

    pub fn favorite_add_local(
        &self,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64> {
        self.favorite_mutations
            .add_local(kind, entity_id, group_name)
    }

    pub fn favorite_remove_local(
        &self,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64> {
        self.favorite_mutations
            .remove_local(kind, entity_id, group_name)
    }

    pub fn saved_group_favorites_snapshot(&self) -> Result<SavedGroupFavoritesSnapshot> {
        Ok(vrcx_0_persistence::saved_group_favorites::snapshot(
            self.db.as_ref(),
            &self.saved_group_owner()?,
        )?)
    }

    pub fn saved_group_collection_create(
        &self,
        input: SavedGroupCollectionCreateInput,
    ) -> Result<i64> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(vrcx_0_application_core::Error::Custom(
                "Saved group collection name is required.".into(),
            ));
        }
        Ok(
            vrcx_0_persistence::saved_group_favorites::create_collection(
                self.db.as_ref(),
                &self.saved_group_owner()?,
                &uuid::Uuid::new_v4().to_string(),
                name,
            )?,
        )
    }

    pub fn saved_group_collection_delete(
        &self,
        input: SavedGroupCollectionDeleteInput,
    ) -> Result<i64> {
        Ok(
            vrcx_0_persistence::saved_group_favorites::delete_collection(
                self.db.as_ref(),
                &self.saved_group_owner()?,
                &input.collection_id,
            )?,
        )
    }

    pub fn saved_group_favorite_add(&self, input: SavedGroupFavoriteAddInput) -> Result<i64> {
        if !is_group_id(input.group_id.trim()) {
            return Err(vrcx_0_application_core::Error::Custom(
                "Saved group favorite requires a canonical group ID.".into(),
            ));
        }
        Ok(vrcx_0_persistence::saved_group_favorites::add_group(
            self.db.as_ref(),
            &self.saved_group_owner()?,
            &input.collection_id,
            &input.group_id,
        )?)
    }

    pub fn saved_group_favorite_remove(&self, input: SavedGroupFavoriteRemoveInput) -> Result<i64> {
        if !is_group_id(input.group_id.trim()) {
            return Err(vrcx_0_application_core::Error::Custom(
                "Saved group favorite requires a canonical group ID.".into(),
            ));
        }
        Ok(vrcx_0_persistence::saved_group_favorites::remove_group(
            self.db.as_ref(),
            &self.saved_group_owner()?,
            &input.group_id,
        )?)
    }

    pub fn mutual_graph_fetch_status(&self) -> MutualGraphFetchStatus {
        self.mutual_graph_fetch.status()
    }

    pub fn mutual_graph_fetch_cancel(
        &self,
        input: MutualGraphFetchCancelInput,
    ) -> Result<MutualGraphFetchStatus> {
        self.mutual_graph_fetch.cancel(input)
    }

    pub fn mutual_graph_fetch_start(
        &self,
        input: MutualGraphFetchStartInput,
    ) -> Result<MutualGraphFetchStatus> {
        self.mutual_graph_fetch.start(
            input,
            self.mutual_graph_store.clone(),
            self.mutual_graph_remote_requests.clone(),
            self.mutual_graph_remote.clone(),
            self.auth_scope.clone(),
            self.tasks.clone(),
        )
    }

    pub async fn mutual_graph_friend_refresh(
        &self,
        input: MutualGraphFriendRefreshInput,
    ) -> Result<MutualGraphFriendRefreshOutput> {
        refresh_mutual_graph_friend(
            MutualGraphRequestDeps::new(
                self.mutual_graph_store.as_ref(),
                self.mutual_graph_remote_requests.as_ref(),
                self.mutual_graph_remote.as_ref(),
                &self.auth_scope,
            ),
            input,
        )
        .await
    }

    pub async fn user_mutual_friends_list(
        &self,
        input: UserMutualFriendsListInput,
    ) -> Result<UserMutualFriendsListOutput> {
        get_user_mutual_friends_list(
            MutualGraphRequestDeps::new(
                self.mutual_graph_store.as_ref(),
                self.mutual_graph_remote_requests.as_ref(),
                self.mutual_graph_remote.as_ref(),
                &self.auth_scope,
            ),
            &self.realtime,
            input,
        )
        .await
    }

    pub fn activity_overlap_view(
        &self,
        input: ActivityOverlapViewBuildInput,
    ) -> Result<ActivityOverlapViewOutput> {
        Ok(vrcx_0_persistence::activity::activity_overlap_view_build(
            self.db.as_ref(),
            input,
        )?)
    }

    pub fn activity_view(&self, input: ActivityViewBuildInput) -> Result<ActivityViewOutput> {
        Ok(vrcx_0_persistence::activity::activity_view_build(
            self.db.as_ref(),
            input,
        )?)
    }

    pub fn activity_page_view(&self, input: ActivityPageBuildInput) -> Result<ActivityPageView> {
        Ok(vrcx_0_persistence::activity_page::activity_page_view_build(
            self.db.as_ref(),
            input,
        )?)
    }

    pub fn avatar_history_clear(&self, user_id: String) -> Result<()> {
        Ok(vrcx_0_persistence::avatars::avatar_history_clear(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn avatar_history_list(
        &self,
        user_id: String,
        limit: i64,
    ) -> Result<Vec<AvatarCacheOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_history_list(
            self.db.as_ref(),
            user_id,
            limit,
        )?)
    }

    pub fn avatar_usage_ranking(&self, user_id: String, limit: i64) -> Result<Vec<AvatarUsageRow>> {
        Ok(vrcx_0_persistence::avatars::avatar_usage_ranking(
            self.db.as_ref(),
            user_id,
            limit,
        )?)
    }

    pub fn avatar_tag_add(&self, avatar_id: String, tag: Value, color: Value) -> Result<i64> {
        Ok(vrcx_0_persistence::avatars::avatar_tag_add(
            self.db.as_ref(),
            avatar_id,
            tag,
            color,
        )?)
    }

    pub fn avatar_tag_remove(&self, avatar_id: String, tag: Value) -> Result<i64> {
        Ok(vrcx_0_persistence::avatars::avatar_tag_remove(
            self.db.as_ref(),
            avatar_id,
            tag,
        )?)
    }

    pub fn avatar_tag_update_color(
        &self,
        avatar_id: String,
        tag: Value,
        color: Value,
    ) -> Result<i64> {
        Ok(vrcx_0_persistence::avatars::avatar_tag_update_color(
            self.db.as_ref(),
            avatar_id,
            tag,
            color,
        )?)
    }

    pub fn avatar_tags_distinct(&self) -> Result<Vec<String>> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_distinct(
            self.db.as_ref(),
        )?)
    }

    pub fn avatar_tags_get(&self, avatar_id: String) -> Result<Vec<AvatarTagOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_get(
            self.db.as_ref(),
            avatar_id,
        )?)
    }

    pub fn avatar_tags_list(&self) -> Result<Vec<AvatarTagOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_list(
            self.db.as_ref(),
        )?)
    }

    pub fn avatar_tags_patch(&self, avatar_id: String, patch: AvatarTagsPatchInput) -> Result<()> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_patch(
            self.db.as_ref(),
            avatar_id,
            patch,
        )?)
    }

    pub fn avatar_tags_remove_all(&self, avatar_id: String) -> Result<i64> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_remove_all(
            self.db.as_ref(),
            avatar_id,
        )?)
    }

    pub fn avatar_tags_replace(
        &self,
        avatar_id: String,
        entries: Vec<AvatarTagInput>,
    ) -> Result<()> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_replace(
            self.db.as_ref(),
            avatar_id,
            entries,
        )?)
    }

    pub fn avatar_time_spent_add(
        &self,
        user_id: String,
        avatar_id: String,
        time_spent: i64,
    ) -> Result<()> {
        Ok(vrcx_0_persistence::avatars::avatar_time_spent_add(
            self.db.as_ref(),
            user_id,
            avatar_id,
            time_spent,
        )?)
    }

    pub fn avatar_time_spent_get(
        &self,
        user_id: String,
        avatar_id: String,
    ) -> Result<AvatarTimeSpentOutput> {
        Ok(vrcx_0_persistence::avatars::avatar_time_spent_get(
            self.db.as_ref(),
            user_id,
            avatar_id,
        )?)
    }

    pub fn avatar_time_spent_list(&self, user_id: String) -> Result<Vec<AvatarTimeSpentOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_time_spent_list(
            self.db.as_ref(),
            user_id,
        )?)
    }

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

    pub fn config_list_values(&self) -> Result<Vec<ConfigReadEntry>> {
        vrcx_0_application::profile::list_config_values(self.profile_config.as_ref())
    }

    pub fn config_remove_value(&self, key: String) -> Result<i64> {
        vrcx_0_application::profile::remove_config_value(self.profile_config.as_ref(), key)
    }

    pub fn config_set_values(&self, entries: Vec<ConfigWriteEntry>) -> Result<()> {
        vrcx_0_application::profile::set_config_values(self.profile_config.as_ref(), entries)
    }

    pub fn broken_game_log_display_names(&self) -> Result<Vec<BrokenGameLogDisplayNameOutput>> {
        Ok(
            vrcx_0_persistence::maintenance::database_maintenance_broken_game_log_display_names_get(
                self.db.as_ref(),
            )?,
        )
    }

    pub fn broken_leave_entries(&self) -> Result<Vec<Value>> {
        Ok(
            vrcx_0_persistence::maintenance::database_maintenance_broken_leave_entries_get(
                self.db.as_ref(),
            )?,
        )
    }

    pub fn max_friend_log_number(&self, user_id: String) -> Result<i64> {
        Ok(
            vrcx_0_persistence::maintenance::database_maintenance_max_friend_log_number_get(
                self.db.as_ref(),
                user_id,
            )?,
        )
    }

    pub fn maintenance_table_sizes(&self, user_id: String) -> Result<MaintenanceTableSizesOutput> {
        Ok(
            vrcx_0_persistence::maintenance::database_maintenance_table_sizes_get(
                self.db.as_ref(),
                user_id,
            )?,
        )
    }

    pub fn ensure_user_tables(&self, user_id: String) -> Result<UserTableContextOutput> {
        Ok(vrcx_0_persistence::maintenance::user_tables_ensure(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn favorite_list(&self, kind: FavoriteEntityKind) -> Result<Vec<FavoriteRow>> {
        let store = vrcx_0_outbound_adapters::LocalFavoriteStore::new(Arc::clone(&self.db));
        vrcx_0_application::favorites::list_local_favorites(&store, &self.current_owner(), kind)
    }

    pub fn favorite_snapshot(&self, kind: FavoriteEntityKind) -> Result<LocalFavoriteSnapshot> {
        let store = vrcx_0_outbound_adapters::LocalFavoriteStore::new(Arc::clone(&self.db));
        vrcx_0_application::favorites::get_local_favorite_snapshot(
            &store,
            &self.current_owner(),
            kind,
        )
    }

    pub fn cleanup_avatar_feed_history(
        &self,
        cutoff_date: Option<String>,
    ) -> Result<AvatarFeedCleanupOutcome> {
        let adapter =
            vrcx_0_outbound_adapters::LocalAvatarApplicationAdapter::new(Arc::clone(&self.db));
        vrcx_0_application::avatars::cleanup_avatar_feed_history(
            &adapter,
            self.auth_scope.snapshot().current_user_id,
            cutoff_date,
        )
    }

    pub fn feed_rows_query(&self, query: FeedRowsQueryInput) -> Result<Vec<FeedRowOutput>> {
        Ok(vrcx_0_persistence::feed::feed_rows_query(
            self.db.as_ref(),
            query,
        )?)
    }

    pub fn friend_log_current_list(&self, user_id: String) -> Result<Vec<FriendLogCurrentOutput>> {
        Ok(vrcx_0_persistence::friends::friend_log_current_list(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn friend_log_history_delete(
        &self,
        user_id: String,
        entry: FriendLogHistoryEntryInput,
    ) -> Result<i64> {
        Ok(vrcx_0_persistence::friends::friend_log_history_delete(
            self.db.as_ref(),
            user_id,
            entry,
        )?)
    }

    pub fn friend_log_history_query(
        &self,
        query: FriendLogHistoryQueryInput,
    ) -> Result<Vec<FriendLogHistoryOutput>> {
        Ok(vrcx_0_persistence::friends::friend_log_history_query(
            self.db.as_ref(),
            query,
        )?)
    }

    pub fn game_log_entries_add(&self, kind: GameLogWriteKind, entries: Vec<Value>) -> Result<u64> {
        Ok(vrcx_0_persistence::game_log::game_log_entries_add(
            self.db.as_ref(),
            &self.current_owner(),
            kind,
            entries,
        )?)
    }

    pub fn game_log_entry_delete(&self, kind: GameLogEntryDeleteKind, entry: Value) -> Result<i64> {
        Ok(vrcx_0_persistence::game_log::game_log_entry_delete(
            self.db.as_ref(),
            &self.current_owner(),
            kind,
            entry,
        )?)
    }

    pub fn game_log_instance_delete(&self, location: String, event_ids: Vec<i64>) -> Result<i64> {
        Ok(vrcx_0_persistence::game_log::game_log_instance_delete(
            self.db.as_ref(),
            &self.current_owner(),
            location,
            event_ids,
        )?)
    }

    pub fn game_log_instance_delete_by_location(&self, location: String) -> Result<i64> {
        Ok(
            vrcx_0_persistence::game_log::game_log_instance_delete_by_location(
                self.db.as_ref(),
                &self.current_owner(),
                location,
            )?,
        )
    }

    pub fn game_log_query(&self, query: GameLogQuery) -> Result<GameLogQueryOutput> {
        Ok(vrcx_0_persistence::game_log::game_log_query(
            self.db.as_ref(),
            &self.current_owner(),
            query,
        )?)
    }

    pub fn previous_instances_by_group_id(
        &self,
        group_id: String,
    ) -> Result<Vec<GameLogPreviousInstanceGroupOutput>> {
        Ok(
            vrcx_0_persistence::game_log::get_previous_instances_by_group_id(
                self.db.as_ref(),
                &self.current_owner(),
                &group_id,
            )?,
        )
    }

    pub fn previous_instances_by_world_id(
        &self,
        world_id: String,
    ) -> Result<Vec<GameLogPreviousInstanceWorldOutput>> {
        Ok(
            vrcx_0_persistence::game_log::get_previous_instances_by_world_id(
                self.db.as_ref(),
                &self.current_owner(),
                &world_id,
            )?,
        )
    }

    pub fn world_friend_visits(&self, world_id: String) -> Result<WorldFriendVisitsOutput> {
        Ok(
            vrcx_0_persistence::social_aggregates::get_world_friend_visits(
                self.db.as_ref(),
                &self.current_owner(),
                &world_id,
            )?,
        )
    }

    pub fn game_log_sessions_query(
        &self,
        input: GameLogSessionsQueryInput,
    ) -> Result<Vec<GameLogSessionDto>> {
        vrcx_0_application_game::game_log_sessions_query(
            &self.game_state_store(),
            &self.current_owner(),
            input,
        )
    }

    pub fn instance_history_query(
        &self,
        input: InstanceHistoryQueryInput,
    ) -> Result<Vec<InstanceHistoryEntryOutput>> {
        vrcx_0_application_game::instance_history_query(
            &self.game_state_store(),
            &self.current_owner(),
            input,
        )
    }

    pub fn local_moderation_get(
        &self,
        owner_user_id: OwnerId,
        user_id: String,
    ) -> Result<Option<LocalModerationOutput>> {
        Ok(vrcx_0_persistence::local_moderation::local_moderation_get(
            self.db.as_ref(),
            owner_user_id,
            user_id,
        )?)
    }

    pub fn mutual_graph_snapshot_get(&self, user_id: String) -> Result<MutualGraphSnapshotOutput> {
        Ok(vrcx_0_persistence::mutual_graph::mutual_graph_snapshot_get(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn local_moderation_list(
        &self,
        owner_user_id: OwnerId,
    ) -> Result<Vec<LocalModerationOutput>> {
        Ok(vrcx_0_persistence::local_moderation::local_moderation_list(
            self.db.as_ref(),
            owner_user_id,
        )?)
    }

    pub fn memo_get_avatar(&self, avatar_id: String) -> Result<Option<AvatarMemoOutput>> {
        Ok(vrcx_0_persistence::memos::memo_get_avatar(
            self.db.as_ref(),
            avatar_id,
        )?)
    }

    pub fn memo_get_user(&self, user_id: String) -> Result<Option<UserMemoOutput>> {
        Ok(vrcx_0_persistence::memos::memo_get_user(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn memo_get_world(&self, world_id: String) -> Result<Option<WorldMemoOutput>> {
        Ok(vrcx_0_persistence::memos::memo_get_world(
            self.db.as_ref(),
            world_id,
        )?)
    }

    pub fn memo_list_user_notes(&self, owner_user_id: OwnerId) -> Result<Vec<UserNoteOutput>> {
        Ok(vrcx_0_persistence::memos::memo_list_user_notes(
            self.db.as_ref(),
            owner_user_id,
        )?)
    }

    pub fn memo_list_users(&self) -> Result<Vec<UserMemoOutput>> {
        Ok(vrcx_0_persistence::memos::memo_list_users(
            self.db.as_ref(),
        )?)
    }

    pub fn memo_save_avatar(&self, avatar_id: String, memo: String) -> Result<MemoSaveResult> {
        Ok(vrcx_0_persistence::memos::memo_save_avatar(
            self.db.as_ref(),
            avatar_id,
            memo,
        )?)
    }

    pub fn memo_save_user(&self, user_id: String, memo: String) -> Result<MemoSaveResult> {
        Ok(vrcx_0_persistence::memos::memo_save_user(
            self.db.as_ref(),
            user_id,
            memo,
        )?)
    }

    pub fn memo_save_world(&self, world_id: String, memo: String) -> Result<MemoSaveResult> {
        Ok(vrcx_0_persistence::memos::memo_save_world(
            self.db.as_ref(),
            world_id,
            memo,
        )?)
    }

    pub fn notification_add_v1(&self, user_id: String, notification: Value) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_add_v1(
            self.db.as_ref(),
            user_id,
            notification,
        )?)
    }

    pub fn notification_add_v2(&self, user_id: String, notification: Value) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_add_v2(
            self.db.as_ref(),
            user_id,
            notification,
        )?)
    }

    pub fn notification_delete(&self, user_id: String, id: String) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_delete(
            self.db.as_ref(),
            user_id,
            id,
        )?)
    }

    pub fn notification_expire(&self, user_id: String, id: String) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_expire(
            self.db.as_ref(),
            user_id,
            id,
        )?)
    }

    pub fn notification_list_query(
        &self,
        query: NotificationListQueryInput,
    ) -> Result<Vec<NotificationListItemOutput>> {
        Ok(vrcx_0_persistence::notifications::notification_list_query(
            self.db.as_ref(),
            query,
        )?)
    }

    pub fn notification_update_expired(
        &self,
        user_id: String,
        id: String,
        expired: bool,
    ) -> Result<()> {
        Ok(
            vrcx_0_persistence::notifications::notification_update_expired(
                self.db.as_ref(),
                user_id,
                id,
                expired,
            )?,
        )
    }

    pub fn notification_v2_expire(&self, user_id: String, id: String) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_v2_expire(
            self.db.as_ref(),
            user_id,
            id,
        )?)
    }

    pub fn notification_v2_mark_seen(&self, user_id: String, id: String) -> Result<()> {
        Ok(
            vrcx_0_persistence::notifications::notification_v2_mark_seen(
                self.db.as_ref(),
                user_id,
                id,
            )?,
        )
    }

    pub fn player_list_current_snapshot(
        &self,
        current_user_id: String,
        current_location: String,
        current_location_started_at: String,
    ) -> Result<PlayerListSnapshotOutput> {
        vrcx_0_application_game::player_list_current_snapshot(
            &self.game_state_store(),
            &self.current_owner(),
            &current_user_id,
            &current_location,
            &current_location_started_at,
        )
    }

    pub fn instance_activity_dates_get(&self, user_id: String) -> Result<Vec<String>> {
        Ok(
            vrcx_0_persistence::player_list::instance_activity_dates_get(
                self.db.as_ref(),
                &self.current_owner(),
                user_id,
            )?,
        )
    }

    pub fn instance_activity_rows_get(
        &self,
        start_date: String,
        end_date: String,
    ) -> Result<Vec<InstanceActivityRowOutput>> {
        Ok(vrcx_0_persistence::player_list::instance_activity_rows_get(
            self.db.as_ref(),
            &self.current_owner(),
            start_date,
            end_date,
        )?)
    }

    pub fn world_summaries_get(
        &self,
        world_ids: Vec<String>,
    ) -> Result<HashMap<String, WorldSummaryOutput>> {
        Ok(vrcx_0_persistence::player_list::world_summaries_get(
            self.db.as_ref(),
            &self.current_owner(),
            world_ids,
        )?)
    }
}
