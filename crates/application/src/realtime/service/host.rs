use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::sync::watch;

use vrcx_0_core::friends::{FriendRecord, FriendRosterBaseline};
use vrcx_0_core::realtime::RealtimeWsMessagePayload;
use vrcx_0_persistence::config as config_store;
use vrcx_0_persistence::realtime::{
    lookup_game_log_world_name, write_realtime_batch, NotificationExpiration,
    RealtimePersistenceBatch, RealtimeWriteCounts,
};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::auth::current_user_get_input;
use vrcx_0_vrchat_client::http_api::{normalize_vrchat_api_endpoint, ApiScope};
use vrcx_0_vrchat_client::realtime::normalize_websocket_domain;
use vrcx_0_vrchat_client::users as remote_users;

use crate::event_bus::{FavoritesChangedPayload, RuntimeEventBus, RuntimeVrchatAuthFailurePayload};
use crate::game_log::RuntimeSnapshot;
use crate::overlay_activity::OverlayActivityRuntime;
use crate::prints::cleanup::{PrintCleanupDeps, PrintCleanupQueue, PrintCleanupTrigger};
use crate::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::realtime::connection::{
    run_realtime_transport, RealtimeMessageSink, RealtimeTransportDeps,
};
use crate::realtime::current_user::RealtimeCurrentUserRuntime;
use crate::realtime::friends::{
    is_friend_event_type, player_joining_feed_entry, RealtimeFriendsRuntime,
};
use crate::realtime::instance_queue::apply_instance_queue_ws_message;
use crate::realtime::invite_automation::decision::{
    evaluate_invite_automation, normalize_invite_automation_mode, InviteAutomationConfig,
    InviteAutomationInput, InviteAutomationMode, InviteAutomationSkipReason, InviteDecision,
    InviteLocationFacts, InviteNotificationFacts, SenderAllowlist,
};
use crate::realtime::invite_automation::runtime::{sender_scope_key, InviteOutcome};
use crate::realtime::notifications::{
    apply_instance_closed_ws_message, apply_notification_ws_message,
};
use crate::realtime::user_cache::UserCacheRuntime;
use crate::realtime::user_query_cache::UserQueryCache;
use crate::realtime::{
    FriendBaselineCausalWatermark, FriendBaselineResult, FriendBaselineSyncOutcome,
    FriendProjection, PendingOfflineTimerAction, RealtimeCurrentUserAuthority,
    RealtimeCurrentUserOutput, RealtimeEntryCorrection, RealtimeEntryCorrectionFields,
    RealtimeEntryCorrectionStream, RealtimeFriendApplyResult, RealtimeFriendOutput,
    RealtimeFriendSnapshot, RealtimeInstanceClosedOutput, RealtimeInstanceQueueProjection,
    RealtimeNotificationOutput, RealtimeNotificationProjection, RealtimeNotificationUpsert,
    RealtimeProjectionSource, RealtimeSessionContext, RealtimeTransportStartResult,
    RealtimeWsStatusPayload,
};
use crate::session::HostSessionRuntime;
use crate::social_baseline::service::{
    reconcile_friend_roster_records, FriendRosterReconcileOutcome,
};
use crate::sync::RuntimeSyncEngine;
use crate::task_supervisor::TaskSupervisor;
use crate::web_client::WebClient;
use crate::world_enrich::is_meaningful_world_name;
use crate::RuntimeAuthScope;
use crate::{Error, Result};

#[cfg(test)]
mod friend_baseline_tests;
#[cfg(test)]
mod friend_joining_tests;
#[cfg(test)]
mod friend_mutation_sink_tests;
mod friend_profile_bulk_load;
#[cfg(test)]
mod friend_profile_bulk_load_tests;
mod lifecycle_current_user;
mod lifecycle_enrichment;
mod lifecycle_friend_baseline;
mod lifecycle_friend_messages;
mod lifecycle_friend_mutation;
mod lifecycle_friend_profile;
mod lifecycle_invite_automation;
mod lifecycle_output;
mod lifecycle_session;
mod lifecycle_world_cache;
mod message_dispatch;
#[cfg(test)]
mod notification_enrichment_tests;
mod persistence;
#[cfg(test)]
mod session_reconnect_tests;
#[cfg(test)]
mod test_support;
mod types;
#[cfg(test)]
mod world_cache_tests;

use lifecycle_world_cache::WorldNameFetchOutcome;

pub use friend_profile_bulk_load::{FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload};
pub use lifecycle_friend_mutation::SyntheticFriendEventOutcome;
pub use types::{RealtimeHostRuntime, RealtimeHostRuntimeDeps, RealtimeStopRequest};
