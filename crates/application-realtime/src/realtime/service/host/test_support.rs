use std::ops::Deref;
use std::path::PathBuf;

pub(super) use std::sync::Arc;
#[cfg(test)]
pub(super) use std::sync::Mutex;
pub(super) use std::time::Duration;

#[cfg(test)]
pub(super) use serde_json::json;
#[cfg(test)]
pub(super) use vrcx_0_persistence::cache_entities::CacheEntityInput;
#[cfg(test)]
pub(super) use vrcx_0_persistence::favorites::favorite_add;
#[cfg(test)]
pub(super) use vrcx_0_persistence::notifications::{
    notification_list_query, NotificationListQueryInput,
};
#[cfg(test)]
pub(super) use vrcx_0_persistence::realtime::NotificationV2Update;
pub(super) use vrcx_0_persistence::storage::StorageService;
#[cfg(test)]
pub(super) use vrcx_0_persistence::worlds::world_cache_upsert;
pub(super) use vrcx_0_persistence::DatabaseService;

#[cfg(test)]
pub(super) use crate::world_enrich::PendingEntryCorrection;
#[cfg(test)]
pub(super) use crate::{
    FriendProjection, RealtimeInstanceClosedProjection, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection,
};
pub(super) use vrcx_0_application_core::{
    HostSessionRuntime, LocalGameContextSource, RuntimeEventBus, RuntimeSyncEngine, TaskSupervisor,
    UnavailableLocalGameContextSource, WebClient,
};
#[cfg(test)]
pub(super) use vrcx_0_application_core::{LocalGameContextSnapshot, OverlayActivityInputSink};
use vrcx_0_application_core::{
    NoopPrintCleanupInputSink, RuntimeAuthScope, RuntimeEventForTest, RuntimeTaskExecutor,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

pub(super) use super::state::{ActiveRealtimeContext, RealtimeHostRuntimeState};
#[cfg(test)]
pub(super) use super::state::{PendingFriendBaseline, RealtimeHostRuntimeMessageSink};
use super::*;

impl RealtimeHostRuntime {
    pub fn ingest_notification_ws_message_for_test(
        self: &Arc<Self>,
        owner_user_id: &str,
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

pub struct TestRealtimeHostRuntime {
    runtime: Arc<RealtimeHostRuntime>,
    #[cfg(test)]
    activity_sink: Arc<TestActivitySink>,
    #[cfg(test)]
    local_game_context: Option<Arc<TestLocalGameContextSource>>,
}

impl Deref for TestRealtimeHostRuntime {
    type Target = Arc<RealtimeHostRuntime>;

    fn deref(&self) -> &Self::Target {
        &self.runtime
    }
}

impl TestRealtimeHostRuntime {
    pub fn database(&self) -> &DatabaseService {
        self.runtime.deps.db.as_ref()
    }

    pub fn web_client(&self) -> &WebClient {
        self.runtime.deps.web.as_ref()
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
        self.runtime.sync_friend_snapshot(
            session.user_id.clone(),
            session.endpoint.clone(),
            session.websocket.clone(),
            None,
            friends_by_id,
        )?;
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

    #[cfg(test)]
    pub(super) fn activity_sink_for_test(&self) -> &TestActivitySink {
        self.activity_sink.as_ref()
    }

    #[cfg(test)]
    pub(super) fn local_game_context_for_test(&self) -> &TestLocalGameContextSource {
        self.local_game_context
            .as_deref()
            .expect("test runtime should use TestLocalGameContextSource")
    }
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
    pub(super) fn delivery_armed(&self) -> bool {
        self.lock_state().delivery_armed
    }

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
            .map(|upsert| upsert.notification.clone())
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
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let storage = StorageService::new(&dir.path.join("storage.json"))?;
    let web = Arc::new(WebClient::new(
        &storage,
        db.as_ref(),
        "wss://pipeline.vrchat.cloud".to_string(),
        env!("CARGO_PKG_VERSION"),
    )?);
    let session = HostSessionRuntime::new();
    let host_session_generation =
        session.set_realtime_context(vrcx_0_application_core::HostRealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        ));
    let world_cache = Arc::new(vrcx_0_application_core::WorldCache::new(
        Arc::clone(&db),
        512,
        Duration::from_secs(30 * 60),
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
    let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
        db,
        web,
        event_bus: RuntimeEventBus::new(),
        sync: RuntimeSyncEngine::new(),
        tasks: TaskSupervisor::new(),
        session: session.clone(),
        auth_scope: RuntimeAuthScope::new(),
        local_game_context,
        #[cfg(test)]
        activity_sink: Some(activity_sink.clone()),
        #[cfg(not(test))]
        activity_sink: None,
        world_cache,
        print_cleanup: Arc::new(NoopPrintCleanupInputSink),
        friend_note_change_sink: None,
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
            generation: 7,
            client_run_id: 1,
            session_generation: host_session_generation,
        });
    }
    Ok((
        dir,
        TestRealtimeHostRuntime {
            runtime,
            #[cfg(test)]
            activity_sink,
            #[cfg(test)]
            local_game_context: test_local_game_context,
        },
        active_session,
    ))
}

#[cfg(test)]
pub(super) fn cached_world_entry(id: &str, name: &str, updated_at: &str) -> CacheEntityInput {
    CacheEntityInput {
        id: json!(id),
        author_id: json!(null),
        author_name: json!(null),
        created_at: json!("2026-01-01T00:00:00.000Z"),
        description: json!(null),
        image_url: json!("image.png"),
        name: json!(name),
        release_status: json!("public"),
        thumbnail_image_url: json!("thumb.png"),
        updated_at: json!(updated_at),
        version: json!(1),
    }
}
