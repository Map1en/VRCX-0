use super::*;
use crate::realtime::invite_automation::runtime::InviteAutomationState;
use crate::world_enrich::PendingEntryCorrection;
use std::collections::HashSet;
use vrcx_0_application_core::WorldCache;

pub(super) struct FriendOwnerGuard<'a> {
    pub(super) _guard: std::sync::MutexGuard<'a, ()>,
}

#[derive(Clone, Debug)]
pub(super) struct ActiveRealtimeContext {
    pub(super) session: RealtimeSessionContext,
    pub(super) generation: u64,
    pub(super) client_run_id: u64,
    pub(super) session_generation: u64,
}

#[derive(Clone, Debug)]
pub(super) struct PendingFriendBaseline {
    pub(super) session: RealtimeSessionContext,
    pub(super) friends_by_id: HashMap<String, FriendRecord>,
    pub(super) feed_entries: Vec<Value>,
    pub(super) projection: FriendProjection,
}

#[derive(Default)]
pub(super) struct ConnectionState {
    pub(super) generation: u64,
    pub(super) active_context: Option<ActiveRealtimeContext>,
}

#[derive(Default)]
pub(super) struct FriendBaselineState {
    pub(super) friend_log_sequence: u64,
    pub(super) pending: Option<PendingFriendBaseline>,
}

#[derive(Default)]
pub(super) struct FriendProfileState {
    pub(super) refetches: HashMap<String, i64>,
}

#[derive(Default)]
pub(super) struct WorldEnrichmentState {
    pub(super) fetches: HashMap<String, i64>,
    pub(super) inflight: HashSet<String>,
    pub(super) pending_corrections: HashMap<String, Vec<PendingEntryCorrection>>,
}

#[derive(Default)]
pub(super) struct AutomationState {
    pub(super) invite: InviteAutomationState,
}

#[derive(Default)]
pub(super) struct RealtimeHostRuntimeState {
    pub(super) connection: ConnectionState,
    pub(super) friend_baseline: FriendBaselineState,
    pub(super) friend_profile: FriendProfileState,
    pub(super) world_enrichment: WorldEnrichmentState,
    pub(super) automation: AutomationState,
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
    pub auth_scope: RuntimeAuthScope,
    pub local_game_context: Arc<dyn LocalGameContextSource>,
    pub activity_sink: Option<Arc<dyn OverlayActivityInputSink>>,
    pub world_cache: Arc<WorldCache>,
    pub print_cleanup: Arc<dyn PrintCleanupInputSink>,
    pub friend_note_change_sink: Option<Arc<dyn Fn() + Send + Sync>>,
}

pub struct RealtimeHostRuntime {
    pub(super) deps: RealtimeHostRuntimeDeps,
    pub(super) state: Mutex<RealtimeHostRuntimeState>,
    pub(super) cancel_tx: watch::Sender<u64>,
    pub(super) transport_lifecycle_tx: broadcast::Sender<RealtimeTransportLifecycleEvent>,
    pub(super) friends: RealtimeFriendsRuntime,
    pub(super) current_user: RealtimeCurrentUserRuntime,
    pub(super) user_cache: UserCacheRuntime,
    pub(super) user_query_cache: UserQueryCache,
    pub(super) world_cache: Arc<WorldCache>,
    pub(super) friend_owner_lock: Mutex<()>,
    pub(super) notification_apply_lock: Arc<tokio::sync::Mutex<()>>,
    pub(super) friend_profile_bulk_load:
        Mutex<super::friend_profile_bulk_load::FriendProfileBulkLoadState>,
    pub(super) friend_profile_bulk_cancel_tx: watch::Sender<u64>,
}

pub(super) struct RealtimeHostRuntimeMessageSink {
    pub(super) runtime: Arc<RealtimeHostRuntime>,
}
