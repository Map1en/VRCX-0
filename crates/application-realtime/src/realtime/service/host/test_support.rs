use std::collections::HashMap;
use std::path::PathBuf;
use vrcx_0_core::OwnerId;

pub(super) use serde_json::json;
pub(super) use std::sync::Arc;
#[cfg(test)]
pub(super) use std::sync::Mutex;
#[cfg(test)]
pub(super) use vrcx_0_contracts::feed::{
    FeedFilter, FeedLatestQueryInput, FeedQueryMode, FeedRowsQueryInput, FeedSearchQueryInput,
};
#[cfg(test)]
pub(super) use vrcx_0_contracts::feed_live::FeedLiveEntry;
#[cfg(test)]
pub(super) use vrcx_0_contracts::friend_log::FriendLogHistoryQueryInput;
#[cfg(test)]
pub(super) use vrcx_0_contracts::notifications::NotificationListQueryInput;
#[cfg(test)]
pub(super) use vrcx_0_contracts::realtime::{FriendLogUpsert, NotificationV2Update};

#[cfg(test)]
pub(super) use crate::world_enrich::PendingEntryCorrection;
#[cfg(test)]
pub(super) use crate::{
    FriendProjection, RealtimeInstanceClosedProjection, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection,
};
#[cfg(test)]
pub(super) use vrcx_0_application_core::RealtimeNotificationProjectionObserver;
pub(super) use vrcx_0_application_core::{
    HostSessionRuntime, LocalGameContextSource, RuntimeEventBus, RuntimeSyncEngine, TaskSupervisor,
    UnavailableLocalGameContextSource, WebClient,
};
#[cfg(test)]
pub(super) use vrcx_0_application_core::{LocalGameContextSnapshot, OverlayActivityInputSink};
use vrcx_0_application_core::{
    MemoryWorldCachePort, NoopPrintCleanupInputSink, NoopWebClientPort, Result, RuntimeAuthScope,
    RuntimeEventForTest, RuntimeTaskExecutor,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

#[cfg(test)]
pub(super) use super::state::RealtimeHostRuntimeMessageSink;
pub(super) use super::state::{
    ActiveRealtimeContext, RealtimeHostRuntime, RealtimeHostRuntimeDeps, RealtimeHostRuntimeState,
};
use crate::realtime::notifications::apply_notification_ws_message;
use crate::realtime::{
    RealtimeMessageSink, RealtimeSessionContext, RealtimeTransport, RealtimeTransportFuture,
    RealtimeTransportStartResult, RealtimeTransportTermination,
};
pub(super) use crate::test_store::TestRealtimeStore;

impl RealtimeHostRuntime {
    pub fn ingest_notification_ws_message_for_test(
        self: &Arc<Self>,
        owner_user_id: &OwnerId,
        endpoint: &str,
        generation: u64,
        payload: &RealtimeWsMessagePayload,
    ) -> bool {
        let Some(output) =
            apply_notification_ws_message(owner_user_id, endpoint, generation, payload)
        else {
            return false;
        };
        self.apply_notification_output(output);
        true
    }
}

#[derive(Clone)]
pub struct TestRealtimeHostRuntime {
    runtime: Arc<RealtimeHostRuntime>,
    store: Arc<TestRealtimeStore>,
    world_cache_port: MemoryWorldCachePort,
    #[cfg(test)]
    activity_sink: Arc<TestActivitySink>,
    #[cfg(test)]
    notification_projection_observer: Arc<TestNotificationProjectionObserver>,
    #[cfg(test)]
    local_game_context: Option<Arc<TestLocalGameContextSource>>,
}

impl TestRealtimeHostRuntime {
    pub fn runtime(&self) -> &Arc<RealtimeHostRuntime> {
        &self.runtime
    }

    pub fn store(&self) -> &TestRealtimeStore {
        self.store.as_ref()
    }

    pub fn database(&self) -> &TestRealtimeStore {
        self.store()
    }

    pub fn web_client(&self) -> &WebClient {
        self.runtime.deps.web.as_ref()
    }

    pub fn cache_world_for_test(&self, id: &str, name: &str, updated_at: &str) {
        self.world_cache_port.insert(json!({
            "id": id,
            "name": name,
            "updatedAt": updated_at,
            "imageUrl": "image.png",
            "thumbnailImageUrl": "thumb.png"
        }));
    }

    pub fn auth_scope(&self) -> &RuntimeAuthScope {
        &self.runtime.deps.auth_scope
    }

    pub fn take_events_for_test(&self) -> Vec<RuntimeEventForTest> {
        self.runtime.deps.event_bus.take_events_for_test()
    }

    pub fn set_task_executor_for_test<E>(&self, executor: E)
    where
        E: RuntimeTaskExecutor + 'static,
    {
        self.runtime.deps.tasks.set_executor(executor);
    }

    pub fn prepare_pending_friend_baseline(
        &self,
        session: &RealtimeSessionContext,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<()> {
        self.runtime.state.lock().unwrap().connection.active_context = None;
        self.runtime.friends.clear();
        self.runtime
            .sync_friend_snapshot(session.clone(), None, friends_by_id)?;
        Ok(())
    }

    pub fn handle_active_friend_ws_message_for_test(&self, payload: &RealtimeWsMessagePayload) {
        let active = self
            .runtime
            .state
            .lock()
            .unwrap()
            .connection
            .active_context
            .clone()
            .expect("test runtime should have an active realtime context");
        self.runtime.handle_friend_ws_message(
            active.generation,
            active.session_generation,
            &active.session,
            payload,
        );
    }

    pub fn handle_friend_ws_message_for_transport_for_test(
        &self,
        transport: &RealtimeTransportStartResult,
        session: &RealtimeSessionContext,
        payload: &RealtimeWsMessagePayload,
    ) {
        self.runtime.handle_friend_ws_message(
            transport.generation,
            transport.session_generation,
            session,
            payload,
        );
    }

    pub fn finish_realtime_transport_for_test(
        &self,
        transport: &RealtimeTransportStartResult,
        termination: RealtimeTransportTermination,
    ) {
        self.runtime
            .finish_realtime_transport(transport.clone(), termination);
    }

    #[cfg(test)]
    pub(super) fn activity_sink_for_test(&self) -> &TestActivitySink {
        self.activity_sink.as_ref()
    }

    #[cfg(test)]
    pub(super) fn notification_projection_observer_for_test(
        &self,
    ) -> &TestNotificationProjectionObserver {
        self.notification_projection_observer.as_ref()
    }

    #[cfg(test)]
    pub(super) fn local_game_context_for_test(&self) -> &TestLocalGameContextSource {
        self.local_game_context
            .as_deref()
            .expect("test runtime should use TestLocalGameContextSource")
    }
}

#[cfg(test)]
pub(super) mod config_store {
    use vrcx_0_application_core::Result;

    pub fn get_bool(store: &dyn crate::RealtimeStore, key: &str, default: bool) -> Result<bool> {
        store.get_bool(key, default)
    }

    pub fn set_bool(store: &dyn crate::RealtimeStore, key: &str, value: bool) -> Result<()> {
        store.set_bool(key, value)
    }
}

#[cfg(test)]
pub(super) fn write_realtime_batch(
    store: &dyn crate::RealtimeStore,
    owner: &OwnerId,
    batch: &vrcx_0_contracts::realtime::RealtimePersistenceBatch,
) -> Result<vrcx_0_contracts::realtime::RealtimeWriteCounts> {
    store.write_realtime_batch(owner, batch)
}

#[cfg(test)]
pub(super) fn notification_list_query(
    store: &TestRealtimeStore,
    query: NotificationListQueryInput,
) -> Result<Vec<vrcx_0_contracts::notifications::NotificationListItemOutput>> {
    store.notification_list(query)
}

#[cfg(test)]
pub(super) fn friend_log_current_list(
    store: &dyn crate::RealtimeStore,
    user_id: String,
) -> Result<Vec<vrcx_0_contracts::friend_log::FriendLogCurrentOutput>> {
    store.friend_log_current_list(&user_id)
}

#[cfg(test)]
pub(super) fn friend_log_history_query(
    store: &dyn crate::RealtimeStore,
    input: FriendLogHistoryQueryInput,
) -> Result<Vec<vrcx_0_contracts::friend_log::FriendLogHistoryOutput>> {
    store.friend_log_history(input)
}

#[cfg(test)]
pub(super) fn feed_rows_query(
    store: &TestRealtimeStore,
    input: FeedRowsQueryInput,
) -> Result<Vec<vrcx_0_contracts::feed::FeedRowOutput>> {
    store.feed_rows(input)
}

#[cfg(test)]
#[derive(Default)]
pub(super) struct TestActivitySink {
    state: Mutex<TestActivitySinkState>,
}

#[cfg(test)]
#[derive(Default)]
struct TestActivitySinkState {
    delivery_armed: bool,
    friend_user_ids: Vec<String>,
    friend_projections: Vec<FriendProjection>,
    notification_projections: Vec<RealtimeNotificationProjection>,
}

#[cfg(test)]
impl TestActivitySink {
    fn lock_state(&self) -> std::sync::MutexGuard<'_, TestActivitySinkState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub(super) fn friend_user_ids(&self) -> Vec<String> {
        self.lock_state().friend_user_ids.clone()
    }

    pub(super) fn take_friend_projections(&self) -> Vec<FriendProjection> {
        std::mem::take(&mut self.lock_state().friend_projections)
    }

    pub(super) fn notification_by_id(&self, id: &str) -> Option<serde_json::Value> {
        self.lock_state()
            .notification_projections
            .iter()
            .rev()
            .flat_map(|projection| projection.upserts.iter())
            .find(|upsert| upsert.notification["id"] == id)
            .map(|upsert| upsert.notification.as_value().clone())
    }
}

#[cfg(test)]
impl OverlayActivityInputSink for TestActivitySink {
    fn set_friend_user_ids(&self, user_ids: Vec<String>) {
        self.lock_state().friend_user_ids = user_ids;
    }

    fn set_delivery_armed(&self, armed: bool) {
        self.lock_state().delivery_armed = armed;
    }

    fn ingest_friend_projection(&self, projection: &FriendProjection) {
        self.lock_state()
            .friend_projections
            .push(projection.clone());
    }

    fn ingest_notification_projection(&self, projection: &RealtimeNotificationProjection) {
        self.lock_state()
            .notification_projections
            .push(projection.clone());
    }

    fn ingest_instance_queue_projection(&self, _projection: &RealtimeInstanceQueueProjection) {}

    fn ingest_instance_closed_projection(&self, _projection: &RealtimeInstanceClosedProjection) {}
}

#[cfg(test)]
#[derive(Default)]
pub(super) struct TestNotificationProjectionObserver {
    projections: Mutex<Vec<RealtimeNotificationProjection>>,
}

#[cfg(test)]
impl TestNotificationProjectionObserver {
    pub(super) fn take(&self) -> Vec<RealtimeNotificationProjection> {
        std::mem::take(
            &mut *self
                .projections
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
        )
    }
}

#[cfg(test)]
impl RealtimeNotificationProjectionObserver for TestNotificationProjectionObserver {
    fn observe_realtime_notification_projection(
        &self,
        projection: &RealtimeNotificationProjection,
    ) {
        self.projections
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(projection.clone());
    }
}

#[cfg(test)]
#[derive(Default)]
struct TestLocalGameContextState {
    location: String,
    player_user_ids: Vec<String>,
}

#[cfg(test)]
pub(super) struct TestLocalGameContextSource {
    session: HostSessionRuntime,
    state: Mutex<TestLocalGameContextState>,
}

#[cfg(test)]
impl TestLocalGameContextSource {
    fn new(session: HostSessionRuntime) -> Self {
        Self {
            session,
            state: Mutex::new(TestLocalGameContextState::default()),
        }
    }

    pub(super) fn set_location(&self, location: impl Into<String>) {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .location = location.into();
    }

    pub(super) fn set_player_user_ids(&self, user_ids: Vec<String>) {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .player_user_ids = user_ids;
    }
}

#[cfg(test)]
impl LocalGameContextSource for TestLocalGameContextSource {
    fn snapshot(&self) -> LocalGameContextSnapshot {
        let session = self.session.snapshot();
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        LocalGameContextSnapshot::Available {
            is_game_running: session.is_game_running,
            location: state.location.clone(),
            destination: String::new(),
            world_name: String::new(),
            player_user_ids: state.player_user_ids.clone(),
        }
    }
}

pub struct TestDir {
    pub(super) path: PathBuf,
}

impl TestDir {
    pub(super) fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-realtime-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(super) struct TestRealtimeTransport;

impl RealtimeTransport for TestRealtimeTransport {
    fn run(
        &self,
        _message_sink: Arc<dyn RealtimeMessageSink>,
        _client_run_id: u64,
        _generation: u64,
        _session_generation: u64,
        _session: RealtimeSessionContext,
        _cancel_rx: tokio::sync::watch::Receiver<u64>,
    ) -> RealtimeTransportFuture {
        Box::pin(async { RealtimeTransportTermination::Stopped })
    }
}

pub(super) struct TestRealtimeRemoteRequests;

impl crate::RealtimeRemoteRequests for TestRealtimeRemoteRequests {
    fn current_user(
        &self,
        endpoint: String,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiRequest> {
        Ok(test_request(endpoint, "/auth/user"))
    }

    fn user(
        &self,
        endpoint: String,
        user_id: String,
    ) -> Result<(
        String,
        vrcx_0_application_core::vrchat_api::VrchatApiRequest,
    )> {
        let user_id = user_id.trim().to_string();
        Ok((
            user_id.clone(),
            test_request(endpoint, &format!("/users/{user_id}")),
        ))
    }

    fn friend_status(
        &self,
        endpoint: String,
        user_id: String,
    ) -> Result<(
        String,
        vrcx_0_application_core::vrchat_api::VrchatApiRequest,
    )> {
        let user_id = user_id.trim().to_string();
        Ok((
            user_id.clone(),
            test_request(endpoint, &format!("/auth/user/friends/{user_id}")),
        ))
    }

    fn favorite_limits(
        &self,
        endpoint: String,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiRequest> {
        Ok(test_request(endpoint, "/auth/user/favoritelimits"))
    }

    fn favorites(
        &self,
        endpoint: String,
        _n: i32,
        _offset: i32,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiRequest> {
        Ok(test_request(endpoint, "/favorites"))
    }

    fn favorite_groups(
        &self,
        endpoint: String,
        _n: i32,
        _offset: i32,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiRequest> {
        Ok(test_request(endpoint, "/favorite/groups"))
    }

    fn friends(
        &self,
        endpoint: String,
        _offline: bool,
        _n: i32,
        _offset: i32,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiRequest> {
        Ok(test_request(endpoint, "/auth/user/friends"))
    }

    fn world(
        &self,
        endpoint: String,
        world_id: String,
    ) -> Result<(
        String,
        vrcx_0_application_core::vrchat_api::VrchatApiRequest,
    )> {
        let world_id = world_id.trim().to_string();
        Ok((
            world_id.clone(),
            test_request(endpoint, &format!("/worlds/{world_id}")),
        ))
    }

    fn invite_send(
        &self,
        endpoint: String,
        receiver_user_id: String,
        body: serde_json::Value,
    ) -> Result<(
        String,
        vrcx_0_application_core::vrchat_api::VrchatApiRequest,
    )> {
        let mut request = test_request(endpoint, &format!("/invite/{receiver_user_id}"));
        request.body = vrcx_0_contracts::vrchat_api::VrchatRequestBody::Json(body);
        Ok((receiver_user_id, request))
    }

    fn notification_hide(
        &self,
        endpoint: String,
        notification_id: String,
        _version: i64,
        _notification_type: String,
        _sender_user_id: String,
    ) -> Result<(
        String,
        vrcx_0_application_core::vrchat_api::VrchatApiRequest,
    )> {
        Ok((
            notification_id.clone(),
            test_request(endpoint, &format!("/notifications/{notification_id}/hide")),
        ))
    }
}

fn test_request(
    endpoint: String,
    path: &str,
) -> vrcx_0_application_core::vrchat_api::VrchatApiRequest {
    vrcx_0_application_core::vrchat_api::VrchatApiRequest {
        endpoint: Some(endpoint),
        path: Some(path.to_string()),
        ..Default::default()
    }
}

pub fn runtime_with_active_session(
    name: &str,
) -> Result<(TestDir, TestRealtimeHostRuntime, RealtimeSessionContext)> {
    runtime_with_active_session_game_context(name, true)
}

#[cfg(test)]
pub(super) fn runtime_with_unavailable_game_context_active_session(
    name: &str,
) -> Result<(TestDir, TestRealtimeHostRuntime, RealtimeSessionContext)> {
    runtime_with_active_session_game_context(name, false)
}

fn runtime_with_active_session_game_context(
    name: &str,
    local_game_context_available: bool,
) -> Result<(TestDir, TestRealtimeHostRuntime, RealtimeSessionContext)> {
    let dir = TestDir::new(name);
    let store = Arc::new(TestRealtimeStore::new(dir.path.join("VRCX-0.sqlite3")));
    let web = Arc::new(WebClient::new(NoopWebClientPort));
    let session = HostSessionRuntime::new();
    let host_session_generation =
        session.set_realtime_context(vrcx_0_application_core::HostRealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        ));
    let world_cache_port = MemoryWorldCachePort::default();
    let world_cache = Arc::new(vrcx_0_application_core::WorldCache::new(
        world_cache_port.clone(),
    ));
    #[cfg(test)]
    let test_local_game_context = local_game_context_available
        .then(|| Arc::new(TestLocalGameContextSource::new(session.clone())));
    #[cfg(test)]
    let local_game_context: Arc<dyn LocalGameContextSource> = test_local_game_context
        .as_ref()
        .map(|source| Arc::clone(source) as Arc<dyn LocalGameContextSource>)
        .unwrap_or_else(|| Arc::new(UnavailableLocalGameContextSource));
    #[cfg(not(test))]
    let local_game_context: Arc<dyn LocalGameContextSource> = {
        let _ = local_game_context_available;
        Arc::new(UnavailableLocalGameContextSource)
    };
    #[cfg(test)]
    let activity_sink = Arc::new(TestActivitySink::default());
    #[cfg(test)]
    let notification_projection_observer = Arc::new(TestNotificationProjectionObserver::default());
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_self", "https://api.vrchat.cloud/api/1");
    let event_bus = RuntimeEventBus::new();
    let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
        store: Arc::clone(&store) as Arc<dyn crate::RealtimeStore>,
        transport: Arc::new(TestRealtimeTransport),
        remote_requests: Arc::new(TestRealtimeRemoteRequests),
        web,
        event_bus: event_bus.clone(),
        backend_status: vrcx_0_application_core::BackendRuntimeStatusPublisher::new(
            vrcx_0_application_core::BackendRuntime::new(
                vrcx_0_application_core::RuntimeHostProfile::Desktop,
            ),
            event_bus.clone(),
        ),
        friend_projection_sink: crate::FriendProjectionSink::new(event_bus.clone(), None),
        sync: RuntimeSyncEngine::new(),
        tasks: TaskSupervisor::new(),
        session: session.clone(),
        auth_scope,
        remote_mutations: Arc::new(vrcx_0_application_core::RemoteMutationGate::default()),
        local_game_context,
        #[cfg(test)]
        activity_sink: Some(activity_sink.clone()),
        #[cfg(not(test))]
        activity_sink: None,
        #[cfg(test)]
        notification_projection_observer: Some(notification_projection_observer.clone()),
        #[cfg(not(test))]
        notification_projection_observer: None,
        world_cache,
        instance_dwell: Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new()),
        print_cleanup: Arc::new(NoopPrintCleanupInputSink),
        current_user_snapshot_sink: None,
    }));
    let active_session = RealtimeSessionContext::new(
        "usr_self".into(),
        "https://api.vrchat.cloud/api/1".into(),
        "wss://pipeline.vrchat.cloud".into(),
    );
    {
        let mut state = runtime.state.lock().unwrap();
        *state = RealtimeHostRuntimeState::default();
        state.connection.generation = 7;
        state.connection.active_context = Some(ActiveRealtimeContext {
            session: active_session.clone(),
            auth_scope_generation: 1,
            generation: 7,
            client_run_id: 1,
            session_generation: host_session_generation,
        });
    }
    Ok((
        dir,
        TestRealtimeHostRuntime {
            runtime,
            store,
            world_cache_port,
            #[cfg(test)]
            activity_sink,
            #[cfg(test)]
            notification_projection_observer,
            #[cfg(test)]
            local_game_context: test_local_game_context,
        },
        active_session,
    ))
}

#[cfg(test)]
pub(super) fn feed_entry_of(entry_type: &str, created_at: &str) -> FeedLiveEntry {
    let created_at = created_at.to_string();
    let user_id = "usr_friend".to_string();
    let display_name = "Friend".to_string();
    match entry_type {
        "GPS" => FeedLiveEntry::Gps {
            created_at,
            user_id,
            display_name,
            location: String::new(),
            world_name: String::new(),
            previous_location: String::new(),
            time: 0,
            group_name: String::new(),
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        },
        "Online" => FeedLiveEntry::Online {
            created_at,
            user_id,
            display_name,
            location: String::new(),
            world_name: String::new(),
            group_name: String::new(),
            time: None,
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        },
        "Offline" => FeedLiveEntry::Offline {
            created_at,
            user_id,
            display_name,
            location: String::new(),
            world_name: String::new(),
            group_name: String::new(),
            time: None,
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        },
        "Status" => FeedLiveEntry::Status {
            created_at,
            user_id,
            display_name,
            status: String::new(),
            status_description: String::new(),
            previous_status: String::new(),
            previous_status_description: String::new(),
            owner_user_id: String::new(),
        },
        "Bio" => FeedLiveEntry::Bio {
            created_at,
            user_id,
            display_name,
            bio: String::new(),
            previous_bio: String::new(),
            owner_user_id: String::new(),
        },
        "Avatar" => FeedLiveEntry::Avatar {
            created_at,
            user_id,
            display_name,
            owner_id: String::new(),
            previous_owner_id: String::new(),
            avatar_name: String::new(),
            previous_avatar_name: String::new(),
            current_avatar_image_url: String::new(),
            current_avatar_thumbnail_image_url: String::new(),
            previous_current_avatar_image_url: String::new(),
            previous_current_avatar_thumbnail_image_url: String::new(),
            current_avatar_tags: None,
            previous_current_avatar_tags: None,
            owner_user_id: String::new(),
        },
        other => panic!("unsupported test feed entry type: {other}"),
    }
}

#[cfg(test)]
pub(super) fn transient_avatar_entry(created_at: &str) -> FeedLiveEntry {
    let mut entry = feed_entry_of("Avatar", created_at);
    if let FeedLiveEntry::Avatar { avatar_name, .. } = &mut entry {
        *avatar_name = "Transient Avatar".to_string();
    }
    entry
}

#[cfg(test)]
pub(super) fn unwritable_feed_entry(created_at: &str) -> FeedLiveEntry {
    FeedLiveEntry::InstanceClosed {
        created_at: created_at.to_string(),
        id: format!("instance.closed:wrld_1:123:{created_at}"),
        location: "wrld_1:123".into(),
        message: "Instance Closed".into(),
        world_name: None,
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    }
}
