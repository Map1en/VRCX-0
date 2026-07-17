use std::path::PathBuf;

pub(super) use std::sync::{Arc, Mutex};
pub(super) use std::time::Duration;

pub(super) use serde_json::json;
pub(super) use vrcx_0_persistence::cache_entities::CacheEntityInput;
pub(super) use vrcx_0_persistence::favorites::favorite_add;
pub(super) use vrcx_0_persistence::notifications::{
    notification_list_query, NotificationListQueryInput,
};
pub(super) use vrcx_0_persistence::realtime::NotificationV2Update;
pub(super) use vrcx_0_persistence::storage::StorageService;
pub(super) use vrcx_0_persistence::worlds::world_cache_upsert;
pub(super) use vrcx_0_persistence::DatabaseService;

pub(super) use crate::overlay_activity::{
    OverlayActivityCandidate, OverlayActivityFilters, OverlayActivityRuntime,
};
pub(super) use crate::world_enrich::PendingEntryCorrection;
pub(super) use crate::{
    HostSessionRuntime, PrintCleanupQueue, RuntimeEventBus, RuntimeSnapshot, RuntimeSyncEngine,
    TaskSupervisor, WebClient,
};

pub(super) use super::types::{
    ActiveRealtimeContext, PendingFriendBaseline, RealtimeHostRuntimeMessageSink,
    RealtimeHostRuntimeState,
};
use super::*;

pub(super) struct TestDir {
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

pub(super) fn runtime_with_active_session(
    name: &str,
) -> Result<(TestDir, Arc<RealtimeHostRuntime>, RealtimeSessionContext)> {
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
        session.set_realtime_context(crate::session::RealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        ));
    let world_cache = Arc::new(crate::world_cache::WorldCache::new(
        Arc::clone(&db),
        512,
        Duration::from_secs(30 * 60),
    ));
    let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
        db,
        web,
        event_bus: RuntimeEventBus::new(),
        sync: RuntimeSyncEngine::new(),
        tasks: TaskSupervisor::new(),
        session,
        auth_scope: RuntimeAuthScope::new(),
        game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
        overlay_activity: OverlayActivityRuntime::default(),
        world_cache,
        print_cleanup: PrintCleanupQueue::new(),
        friend_note_change_sink: None,
    }));
    let active_session = RealtimeSessionContext::new(
        "usr_self".into(),
        "https://api.vrchat.cloud/api/1".into(),
        "wss://pipeline.vrchat.cloud".into(),
    );
    {
        let mut state = runtime.state.lock().unwrap();
        *state = RealtimeHostRuntimeState {
            generation: 7,
            active_context: Some(ActiveRealtimeContext {
                session: active_session.clone(),
                generation: 7,
                client_run_id: 1,
                session_generation: host_session_generation,
            }),
            ..RealtimeHostRuntimeState::default()
        };
    }
    Ok((dir, runtime, active_session))
}

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

pub(super) fn invite_candidate(user_id: &str) -> OverlayActivityCandidate {
    OverlayActivityCandidate {
        source_id: format!("invite:{user_id}"),
        activity_type: "invite".to_string(),
        created_at: "2026-06-01T00:00:00.000Z".to_string(),
        actor_user_id: user_id.to_string(),
        actor_display_name: "Friend".to_string(),
        current_instance: false,
        payload: json!({}),
    }
}
