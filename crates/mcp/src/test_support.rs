use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use vrcx_0_application::favorites::{FavoriteMutationCoordinator, FavoriteMutationRuntimeDeps};
use vrcx_0_application::social::{
    MutualGraphFetchRuntime, MutualGraphFetchStartInput, MutualGraphFetchStatus,
};
use vrcx_0_application_core::RemoteMutationGate;
use vrcx_0_application_core::{
    HostSessionRuntime, NoopPrintCleanupInputSink, RuntimeAuthScope, RuntimeDiagnostics,
    RuntimeEventBus, RuntimeSyncEngine, TaskSupervisor, UnavailableLocalGameContextSource,
    WebClient, WorldCache,
};
use vrcx_0_application_realtime::{RealtimeHostRuntime, RealtimeHostRuntimeDeps};
use vrcx_0_contracts::feed::{FeedRowOutput, FeedRowsQueryInput};
use vrcx_0_persistence::{
    config::ConfigRepository, game_log::ensure_game_log_tables, storage::StorageService,
    DatabaseService,
};

use crate::runtime::McpRuntime;
use crate::{
    McpActivityQueryPort, McpActivitySession, McpConfigPort, McpFavoritesQueryPort,
    McpFeedQueryPort, McpFriendCurrent, McpFriendLocalDataPort, McpFriendMemo, McpInterruptCheck,
    McpLocalModeration, McpMemoSave, McpMutualGraphMeta, McpMutualGraphPort,
    McpSocialHistoryQueryPort,
};
use vrcx_0_contracts::social_aggregates as social;
use vrcx_0_contracts::FavoriteRow;
use vrcx_0_core::{FavoriteEntityKind, OwnerId};
use vrcx_0_persistence::{
    activity, favorites, friends, local_moderation, memos, social_aggregates,
};

pub(crate) struct TestMcpConfigAdapter {
    config: ConfigRepository,
}

pub(crate) struct TestMcpMutualGraphAdapter {
    runtime: MutualGraphFetchRuntime,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    auth_scope: RuntimeAuthScope,
    tasks: TaskSupervisor,
}

impl TestMcpMutualGraphAdapter {
    pub(crate) fn new(
        runtime: MutualGraphFetchRuntime,
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        auth_scope: RuntimeAuthScope,
        tasks: TaskSupervisor,
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

impl McpMutualGraphPort for TestMcpMutualGraphAdapter {
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
                    total_count: meta.total_count.map(|value| value as usize),
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

impl TestMcpConfigAdapter {
    pub(crate) fn new(config: ConfigRepository) -> Self {
        Self { config }
    }
}

impl McpConfigPort for TestMcpConfigAdapter {
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

pub(crate) struct TestMcpActivityQueryAdapter {
    db: Arc<DatabaseService>,
}

impl TestMcpActivityQueryAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpActivityQueryPort for TestMcpActivityQueryAdapter {
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

    fn friend_log(
        &self,
        input: social::FriendLogInput,
    ) -> vrcx_0_application_core::Result<social::FriendLogOutput> {
        social_aggregates::get_friend_log(self.db.as_ref(), input).map_err(Into::into)
    }

    fn activity_sessions(
        &self,
        owner_user_id: OwnerId,
    ) -> vrcx_0_application_core::Result<Vec<McpActivitySession>> {
        activity::activity_sessions_get(self.db.as_ref(), owner_user_id.to_string())
            .map(|sessions| {
                sessions
                    .into_iter()
                    .map(|session| McpActivitySession {
                        start: session.start,
                        end: session.end,
                        is_open_tail: session.is_open_tail,
                    })
                    .collect()
            })
            .map_err(Into::into)
    }
}

pub(crate) struct TestMcpSocialHistoryQueryAdapter {
    db: Arc<DatabaseService>,
}

impl TestMcpSocialHistoryQueryAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpSocialHistoryQueryPort for TestMcpSocialHistoryQueryAdapter {
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

    fn friend_log(
        &self,
        input: social::FriendLogInput,
    ) -> vrcx_0_application_core::Result<social::FriendLogOutput> {
        social_aggregates::get_friend_log(self.db.as_ref(), input).map_err(Into::into)
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

pub(crate) struct TestMcpFriendLocalDataAdapter {
    db: Arc<DatabaseService>,
}

impl TestMcpFriendLocalDataAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpFriendLocalDataPort for TestMcpFriendLocalDataAdapter {
    fn memo_get_user(
        &self,
        user_id: String,
    ) -> vrcx_0_application_core::Result<Option<McpFriendMemo>> {
        memos::memo_get_user(self.db.as_ref(), user_id)
            .map(|row| row.map(test_friend_memo))
            .map_err(Into::into)
    }

    fn memo_list_users_page(
        &self,
        limit: i64,
        cursor: Option<(&str, &str)>,
    ) -> vrcx_0_application_core::Result<Vec<McpFriendMemo>> {
        memos::memo_list_users_page(self.db.as_ref(), limit, cursor)
            .map(|rows| rows.into_iter().map(test_friend_memo).collect())
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

fn test_friend_memo(row: memos::UserMemoOutput) -> McpFriendMemo {
    McpFriendMemo {
        user_id: row.user_id,
        edited_at: row.edited_at,
        memo: row.memo,
    }
}

pub(crate) struct TestMcpFavoritesQueryAdapter {
    db: Arc<DatabaseService>,
}

impl TestMcpFavoritesQueryAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpFavoritesQueryPort for TestMcpFavoritesQueryAdapter {
    fn favorite_list(
        &self,
        owner_user_id: &OwnerId,
        kind: FavoriteEntityKind,
    ) -> vrcx_0_application_core::Result<Vec<FavoriteRow>> {
        favorites::favorite_list(self.db.as_ref(), Some(owner_user_id), kind).map_err(Into::into)
    }
}

pub(crate) struct TestMcpFeedQueryAdapter {
    db: Arc<DatabaseService>,
}

impl TestMcpFeedQueryAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl McpFeedQueryPort for TestMcpFeedQueryAdapter {
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

pub(crate) struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-mcp-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(crate) fn test_runtime(
    name: &str,
    auth_scope_user_id: &str,
) -> Result<(TestDir, McpRuntime), Box<dyn std::error::Error>> {
    let (dir, runtime, _) = test_runtime_with_event_bus(name, auth_scope_user_id)?;
    Ok((dir, runtime))
}

pub(crate) fn test_runtime_with_event_bus(
    name: &str,
    auth_scope_user_id: &str,
) -> Result<(TestDir, McpRuntime, RuntimeEventBus), Box<dyn std::error::Error>> {
    let (dir, runtime, _, event_bus) =
        test_runtime_with_database_and_event_bus(name, auth_scope_user_id)?;
    Ok((dir, runtime, event_bus))
}

pub(crate) fn test_runtime_with_database(
    name: &str,
    auth_scope_user_id: &str,
) -> Result<(TestDir, McpRuntime, Arc<DatabaseService>), Box<dyn std::error::Error>> {
    let (dir, runtime, db, _) = test_runtime_with_database_and_event_bus(name, auth_scope_user_id)?;
    Ok((dir, runtime, db))
}

type TestRuntimeWithDatabaseAndEventBus =
    (TestDir, McpRuntime, Arc<DatabaseService>, RuntimeEventBus);

fn test_runtime_with_database_and_event_bus(
    name: &str,
    auth_scope_user_id: &str,
) -> Result<TestRuntimeWithDatabaseAndEventBus, Box<dyn std::error::Error>> {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    ensure_game_log_tables(db.as_ref())?;
    let storage = StorageService::new(&dir.path.join("storage.json"))?;
    let web = Arc::new(WebClient::new(
        vrcx_0_outbound_adapters::LocalWebClientAdapter::new(
            &storage,
            Arc::clone(&db),
            "wss://pipeline.vrchat.cloud".into(),
            env!("CARGO_PKG_VERSION"),
        )?,
    ));
    let auth_scope = RuntimeAuthScope::new();
    if !auth_scope_user_id.trim().is_empty() {
        auth_scope.set(auth_scope_user_id, "https://api.vrchat.cloud/api/1");
    }
    let event_bus = RuntimeEventBus::new();
    let sync = RuntimeSyncEngine::new();
    let diagnostics = RuntimeDiagnostics::new();
    let tasks = TaskSupervisor::new();
    let session = HostSessionRuntime::new();
    let world_cache = Arc::new(WorldCache::new(
        vrcx_0_outbound_adapters::LocalWorldCacheAdapter::new(
            Arc::clone(&db),
            512,
            Duration::from_secs(30 * 60),
        ),
    ));
    let remote_mutations = Arc::new(RemoteMutationGate::default());
    let favorite_mutations = FavoriteMutationCoordinator::new(
        Arc::new(vrcx_0_outbound_adapters::LocalFavoriteStore::new(
            Arc::clone(&db),
        )),
        Arc::new(vrcx_0_outbound_adapters::VrchatFavoriteRemote::new(
            Arc::clone(&web),
            diagnostics.clone(),
            sync.clone(),
        )),
        FavoriteMutationRuntimeDeps::new(
            diagnostics,
            sync.clone(),
            event_bus.clone(),
            auth_scope.clone(),
            Arc::clone(&remote_mutations),
        ),
    );
    let backend_status = vrcx_0_application_core::BackendRuntimeStatusPublisher::new(
        vrcx_0_application_core::BackendRuntime::new(
            vrcx_0_application_core::RuntimeHostProfile::Desktop,
        ),
        event_bus.clone(),
    );
    let realtime_store: Arc<dyn vrcx_0_application_realtime::RealtimeStore> = Arc::new(
        vrcx_0_outbound_adapters::PersistenceRealtimeStore::new(Arc::clone(&db)),
    );
    let realtime_transport: Arc<dyn vrcx_0_application_realtime::RealtimeTransport> =
        Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeTransport::new(
            Arc::clone(&realtime_store),
            Arc::clone(&web),
            backend_status.clone(),
        ));
    let realtime_runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps::new(
        realtime_store,
        realtime_transport,
        Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeRemoteRequests),
        Arc::clone(&web),
        event_bus.clone(),
        backend_status,
        vrcx_0_application_realtime::FriendProjectionSink::new(event_bus.clone(), None),
        sync,
        tasks.clone(),
        session,
        auth_scope.clone(),
        remote_mutations,
        Arc::new(UnavailableLocalGameContextSource),
        None,
        None,
        world_cache,
        Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new()),
        Arc::new(NoopPrintCleanupInputSink),
        None,
    )));
    let runtime = McpRuntime {
        realtime_runtime,
        auth_scope: auth_scope.clone(),
        config: Arc::new(TestMcpConfigAdapter::new(ConfigRepository::new(
            Arc::clone(&db),
        ))),
        activity_queries: Arc::new(TestMcpActivityQueryAdapter::new(Arc::clone(&db))),
        social_history_queries: Arc::new(TestMcpSocialHistoryQueryAdapter::new(Arc::clone(&db))),
        friend_local_data: Arc::new(TestMcpFriendLocalDataAdapter::new(Arc::clone(&db))),
        favorites_queries: Arc::new(TestMcpFavoritesQueryAdapter::new(Arc::clone(&db))),
        feed_queries: Arc::new(TestMcpFeedQueryAdapter::new(Arc::clone(&db))),
        mutual_graph: Arc::new(TestMcpMutualGraphAdapter::new(
            MutualGraphFetchRuntime::new(),
            Arc::clone(&db),
            Arc::clone(&web),
            auth_scope.clone(),
            tasks.clone(),
        )),
        favorite_mutations,
        tasks,
        caller: crate::runtime::McpCaller::ExternalServer,
    };
    Ok((dir, runtime, db, event_bus))
}
