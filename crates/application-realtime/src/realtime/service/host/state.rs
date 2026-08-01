use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::sync::{broadcast, watch};
use vrcx_0_application_core::{
    HostSessionRuntime, LocalGameContextSource, OverlayActivityInputSink, PrintCleanupInputSink,
    RuntimeAuthScope, RuntimeEventBus, RuntimeSyncEngine, TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint;

use crate::realtime::current_user::RealtimeCurrentUserRuntime;
use crate::realtime::friends::RealtimeFriendsRuntime;
use crate::realtime::invite_automation::runtime::InviteAutomationState;
use crate::realtime::user_cache::UserCacheRuntime;
use crate::realtime::user_query_cache::UserQueryCache;
use crate::realtime::{
    FriendProjection, FriendStateBucketAuthority, RealtimeSessionContext,
    RealtimeTransportLifecycleEvent,
};
use crate::world_enrich::PendingEntryCorrection;

pub(super) struct FriendOwnerGuard<'a> {
    pub(super) _guard: std::sync::MutexGuard<'a, ()>,
}

pub(super) enum FriendLogMutation {
    Remove { user_id: String },
    Upsert { record: Box<FriendRecord> },
}

pub(super) type CurrentUserRefreshStatus = Option<std::result::Result<bool, String>>;

pub(super) struct ScopedFriendLogMutation {
    owner_user_id: String,
    endpoint: String,
    mutation: FriendLogMutation,
}

impl ScopedFriendLogMutation {
    pub(super) fn new(owner_user_id: &str, endpoint: &str, mutation: FriendLogMutation) -> Self {
        Self {
            owner_user_id: owner_user_id.trim().to_string(),
            endpoint: normalize_vrchat_api_endpoint(Some(endpoint)),
            mutation,
        }
    }

    pub(super) fn apply(self, baseline: &mut FriendBaselineState) {
        let Some(pending) = baseline.pending.as_mut() else {
            return;
        };
        if pending.session.user_id.trim() != self.owner_user_id
            || normalize_vrchat_api_endpoint(Some(&pending.session.endpoint)) != self.endpoint
        {
            return;
        }

        match self.mutation {
            FriendLogMutation::Remove { user_id } => {
                pending.friends_by_id.remove(&user_id);
                pending
                    .projection
                    .patches
                    .retain(|patch| patch.user_id != user_id);
                if !pending
                    .projection
                    .removals
                    .iter()
                    .any(|removed_user_id| removed_user_id == &user_id)
                {
                    pending.projection.removals.push(user_id);
                }
            }
            FriendLogMutation::Upsert { record } => {
                let record = *record;
                let user_id = record.id.clone();
                let state_bucket = record.state_bucket.clone();
                pending
                    .friends_by_id
                    .insert(user_id.clone(), record.clone());
                pending
                    .projection
                    .removals
                    .retain(|removed_user_id| removed_user_id != &user_id);
                pending
                    .projection
                    .patches
                    .retain(|existing| existing.user_id != user_id);
                pending
                    .projection
                    .patches
                    .push(crate::realtime::FriendProjectionPatch {
                        user_id,
                        patch: record,
                        state_bucket,
                        state_bucket_authority: FriendStateBucketAuthority::Explicit,
                    });
            }
        }
        pending.projection.friend_log_changed = true;
    }
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
    pub(super) current_user_refresh_inflight:
        Mutex<Option<watch::Receiver<CurrentUserRefreshStatus>>>,
}

pub(super) struct RealtimeHostRuntimeMessageSink {
    pub(super) runtime: Arc<RealtimeHostRuntime>,
}
