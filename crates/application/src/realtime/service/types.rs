use super::*;

pub(super) const MAX_QUEUED_FRIEND_MESSAGES: usize = 512;

#[derive(Clone, Debug)]
pub(super) struct ActiveRealtimeContext {
    pub(super) session: RealtimeSessionContext,
    pub(super) generation: u64,
    pub(super) client_run_id: u64,
    pub(super) session_generation: u64,
}

#[derive(Default)]
pub(super) struct RealtimeHostRuntimeState {
    pub(super) generation: u64,
    pub(super) active_context: Option<ActiveRealtimeContext>,
    pub(super) friend_messages_paused: bool,
    pub(super) queued_friend_messages: Vec<RealtimeWsMessagePayload>,
    pub(super) friend_profile_refetches: HashMap<String, i64>,
}

#[derive(Clone, Debug, Default)]
pub struct RealtimeStopRequest {
    pub user_id: Option<String>,
    pub endpoint: Option<String>,
    pub websocket: Option<String>,
    pub client_run_id: Option<u64>,
    pub generation: Option<u64>,
}

impl RealtimeStopRequest {
    pub(super) fn has_scope(&self) -> bool {
        self.user_id.is_some()
            || self.endpoint.is_some()
            || self.websocket.is_some()
            || self.client_run_id.is_some()
            || self.generation.is_some()
    }

    pub(super) fn matches_active(&self, active: &ActiveRealtimeContext) -> bool {
        let matches_string = |expected: &Option<String>, actual: &str| {
            expected
                .as_ref()
                .map(|value| value.trim() == actual)
                .unwrap_or(true)
        };

        matches_string(&self.user_id, &active.session.user_id)
            && matches_string(&self.endpoint, &active.session.endpoint)
            && matches_string(&self.websocket, &active.session.websocket)
            && self
                .client_run_id
                .map(|client_run_id| client_run_id == active.client_run_id)
                .unwrap_or(true)
            && self
                .generation
                .map(|generation| generation == active.generation)
                .unwrap_or(true)
    }
}

#[derive(Clone)]
pub struct RealtimeHostRuntimeDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub event_bus: RuntimeEventBus,
    pub sync: RuntimeSyncEngine,
    pub tasks: TaskSupervisor,
    pub session: HostSessionRuntime,
    pub game_log_snapshot: Arc<Mutex<RuntimeSnapshot>>,
    pub overlay_activity: OverlayActivityRuntime,
}

pub struct RealtimeHostRuntime {
    pub(super) deps: RealtimeHostRuntimeDeps,
    pub(super) state: Mutex<RealtimeHostRuntimeState>,
    pub(super) cancel_tx: watch::Sender<u64>,
    pub(super) friends: RealtimeFriendsRuntime,
    pub(super) current_user: RealtimeCurrentUserRuntime,
}

pub(super) struct RealtimeHostRuntimeMessageSink {
    pub(super) runtime: Arc<RealtimeHostRuntime>,
}
