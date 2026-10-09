use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::sync::{broadcast, watch};
use vrcx_0_application_core::{
    ActivityIngress, FileCache, HostSessionRuntime, InstanceDwellRegistry,
    LocalGameContextSnapshot, LocalGameContextSource, PrintCleanupInputSink,
    RealtimeNotificationProjectionObserver, RemoteMutationGate, RuntimeAuthScope, RuntimeEventBus,
    RuntimeSyncEngine, TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::friends::FriendBaselineEntry;
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;

use super::feed::FeedLiveCache;
use crate::realtime::current_user::RealtimeCurrentUserRuntime;
use crate::realtime::friends::{baseline_friend_view, RealtimeFriendsRuntime};
use crate::realtime::invite_automation::runtime::InviteAutomationState;
use crate::realtime::user_facts::UserFactStore;
use crate::realtime::user_query_cache::UserQueryCache;
use crate::realtime::{FriendProjection, RealtimeSessionContext, RealtimeTransportLifecycleEvent};
use crate::world_enrich::PendingEntryCorrection;
use vrcx_0_core::OwnerId;

pub(super) struct FriendOwnerGuard<'a> {
    pub(super) _guard: std::sync::MutexGuard<'a, ()>,
}

pub(super) enum FriendLogMutation {
    Remove { user_id: String },
    Upsert { entry: Box<FriendBaselineEntry> },
}

pub(super) type CurrentUserRefreshStatus = Option<std::result::Result<bool, String>>;

pub(super) struct ScopedFriendLogMutation {
    owner_user_id: OwnerId,
    endpoint: String,
    mutation: FriendLogMutation,
}

impl ScopedFriendLogMutation {
    pub(super) fn new(
        owner_user_id: &OwnerId,
        endpoint: &str,
        mutation: FriendLogMutation,
    ) -> Self {
        Self {
            owner_user_id: OwnerId::new(owner_user_id.as_str().trim()),
            endpoint: normalize_vrchat_api_endpoint(Some(endpoint)),
            mutation,
        }
    }

    pub(super) fn apply(self, baseline: &mut FriendBaselineState) {
        let Some(queued) = baseline.queued.as_mut() else {
            return;
        };
        if queued.session.user_id.trim() != self.owner_user_id.as_str()
            || normalize_vrchat_api_endpoint(Some(&queued.session.endpoint)) != self.endpoint
        {
            return;
        }

        match self.mutation {
            FriendLogMutation::Remove { user_id } => {
                queued.friends_by_id.remove(&user_id);
                queued
                    .projection
                    .patches
                    .retain(|patch| patch.user_id != user_id);
                if !queued
                    .projection
                    .removals
                    .iter()
                    .any(|removed_user_id| removed_user_id == &user_id)
                {
                    queued.projection.removals.push(user_id);
                }
            }
            FriendLogMutation::Upsert { entry } => {
                let user_id = entry.record.id.clone();
                let (record, presence) = baseline_friend_view(&entry);
                queued.friends_by_id.insert(user_id.clone(), *entry);
                queued
                    .projection
                    .removals
                    .retain(|removed_user_id| removed_user_id != &user_id);
                queued
                    .projection
                    .patches
                    .retain(|existing| existing.user_id != user_id);
                queued
                    .projection
                    .patches
                    .push(crate::realtime::FriendProjectionPatch {
                        user_id,
                        presence,
                        record,
                    });
            }
        }
        queued.projection.friend_log_changed = true;
    }
}

#[derive(Clone, Debug)]
pub(super) struct ActiveRealtimeContext {
    pub(super) session: RealtimeSessionContext,
    pub(super) auth_scope_generation: u64,
    pub(super) generation: u64,
    pub(super) client_run_id: u64,
    pub(super) session_generation: u64,
}

#[derive(Clone, Debug)]
pub(super) struct QueuedFriendBaseline {
    pub(super) session: RealtimeSessionContext,
    pub(super) friends_by_id: HashMap<String, FriendBaselineEntry>,
    pub(super) feed_entries: Vec<FeedLiveEntry>,
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
    pub(super) queued: Option<QueuedFriendBaseline>,
}

#[derive(Default)]
pub(super) struct FriendProfileState {
    pub(super) refetches: HashMap<String, i64>,
}

#[derive(Default)]
pub(super) struct WorldEnrichmentState {
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
    pub(crate) store: Arc<dyn crate::RealtimeStore>,
    pub(crate) transport: Arc<dyn crate::realtime::RealtimeTransport>,
    pub(crate) remote_requests: Arc<dyn crate::RealtimeRemoteRequests>,
    pub(crate) web: Arc<WebClient>,
    pub event_bus: RuntimeEventBus,
    pub backend_status: vrcx_0_application_core::BackendRuntimeStatusPublisher,
    pub friend_projection_sink: crate::FriendProjectionSink,
    pub sync: RuntimeSyncEngine,
    pub tasks: TaskSupervisor,
    pub session: HostSessionRuntime,
    pub auth_scope: RuntimeAuthScope,
    pub remote_mutations: Arc<RemoteMutationGate>,
    pub local_game_context: Arc<dyn LocalGameContextSource>,
    pub activity: Option<Arc<dyn ActivityIngress>>,
    pub notification_projection_observer: Option<Arc<dyn RealtimeNotificationProjectionObserver>>,
    pub world_cache: Arc<WorldCache>,
    pub file_cache: FileCache,
    pub instance_dwell: Arc<InstanceDwellRegistry>,
    pub print_cleanup: Arc<dyn PrintCleanupInputSink>,
    pub current_user_snapshot_sink: Option<RealtimeCurrentUserSnapshotSink>,
}

impl RealtimeHostRuntimeDeps {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<dyn crate::RealtimeStore>,
        transport: Arc<dyn crate::realtime::RealtimeTransport>,
        remote_requests: Arc<dyn crate::RealtimeRemoteRequests>,
        web: Arc<WebClient>,
        event_bus: RuntimeEventBus,
        backend_status: vrcx_0_application_core::BackendRuntimeStatusPublisher,
        friend_projection_sink: crate::FriendProjectionSink,
        sync: RuntimeSyncEngine,
        tasks: TaskSupervisor,
        session: HostSessionRuntime,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
        local_game_context: Arc<dyn LocalGameContextSource>,
        activity: Option<Arc<dyn ActivityIngress>>,
        notification_projection_observer: Option<Arc<dyn RealtimeNotificationProjectionObserver>>,
        world_cache: Arc<WorldCache>,
        file_cache: FileCache,
        instance_dwell: Arc<InstanceDwellRegistry>,
        print_cleanup: Arc<dyn PrintCleanupInputSink>,
        current_user_snapshot_sink: Option<RealtimeCurrentUserSnapshotSink>,
    ) -> Self {
        Self {
            store,
            transport,
            remote_requests,
            web,
            event_bus,
            backend_status,
            friend_projection_sink,
            sync,
            tasks,
            session,
            auth_scope,
            remote_mutations,
            local_game_context,
            activity,
            notification_projection_observer,
            world_cache,
            file_cache,
            instance_dwell,
            print_cleanup,
            current_user_snapshot_sink,
        }
    }
}

pub type RealtimeCurrentUserSnapshotSink =
    Arc<dyn Fn(&RealtimeSessionContext, u64, Value) + Send + Sync>;

pub struct RealtimeHostRuntime {
    pub(super) deps: RealtimeHostRuntimeDeps,
    pub(super) state: Mutex<RealtimeHostRuntimeState>,
    pub(super) cancel_tx: watch::Sender<u64>,
    pub(super) transport_lifecycle_tx: broadcast::Sender<RealtimeTransportLifecycleEvent>,
    pub(super) friends: RealtimeFriendsRuntime,
    pub(super) current_user: RealtimeCurrentUserRuntime,
    pub(super) user_facts: UserFactStore,
    pub(super) user_query_cache: UserQueryCache,
    pub(super) world_cache: Arc<WorldCache>,
    pub(super) friend_owner_lock: Mutex<()>,
    pub(super) feed_owner_lock: Mutex<()>,
    pub(super) feed_live_cache: Mutex<FeedLiveCache>,
    pub(super) feed_persistence_disabled: AtomicBool,
    pub(super) notification_apply_lock: tokio::sync::Mutex<()>,
    pub(super) friend_profile_bulk_load:
        Mutex<super::friend_profile_bulk_load::FriendProfileBulkLoadState>,
    pub(super) friend_profile_bulk_cancel_tx: watch::Sender<u64>,
    pub(super) current_user_refresh_inflight:
        Mutex<Option<watch::Receiver<CurrentUserRefreshStatus>>>,
    pub(super) pending_realtime_persistence: Mutex<PendingRealtimePersistence>,
}

pub(super) struct PendingRealtimePersistence {
    pub(super) batches: std::collections::VecDeque<(
        vrcx_0_core::OwnerId,
        vrcx_0_contracts::realtime::RealtimePersistenceBatch,
        bool,
    )>,
    pub(super) retry_worker_running: bool,
}

impl RealtimeHostRuntime {
    pub fn local_game_context(&self) -> LocalGameContextSnapshot {
        self.deps.local_game_context.snapshot()
    }
}

pub(super) struct RealtimeHostRuntimeMessageSink {
    pub(super) runtime: Arc<RealtimeHostRuntime>,
}
