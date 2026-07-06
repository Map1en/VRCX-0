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
use vrcx_0_vrchat_client::http_api::ApiScope;
use vrcx_0_vrchat_client::realtime::normalize_websocket_domain;
use vrcx_0_vrchat_client::users as remote_users;

use crate::event_bus::RuntimeEventBus;
use crate::game_log::RuntimeSnapshot;
use crate::overlay_activity::OverlayActivityRuntime;
use crate::prints::cleanup::{PrintCleanupDeps, PrintCleanupQueue, PrintCleanupTrigger};
use crate::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::realtime::connection::{
    run_realtime_transport, RealtimeMessageSink, RealtimeTransportDeps,
};
use crate::realtime::current_user::RealtimeCurrentUserRuntime;
use crate::realtime::friends::{is_friend_event_type, RealtimeFriendsRuntime};
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
    FriendBaselineResult, FriendProjection, PendingOfflineTimerAction,
    RealtimeCurrentUserAuthority, RealtimeCurrentUserOutput, RealtimeEntryCorrection,
    RealtimeEntryCorrectionFields, RealtimeEntryCorrectionStream, RealtimeFriendApplyResult,
    RealtimeFriendOutput, RealtimeInstanceClosedOutput, RealtimeInstanceQueueProjection,
    RealtimeNotificationOutput, RealtimeNotificationProjection, RealtimeNotificationUpsert,
    RealtimeSessionContext, RealtimeTransportStartResult, RealtimeWsStatusPayload,
};
use crate::session::HostSessionRuntime;
use crate::sync::RuntimeSyncEngine;
use crate::task_supervisor::TaskSupervisor;
use crate::web_client::WebClient;
use crate::world_enrich::is_meaningful_world_name;
use crate::RuntimeAuthScope;
use crate::{Error, Result};

#[cfg(test)]
#[path = "../../../tests/realtime/service/friend_baseline_tests.rs"]
mod friend_baseline_tests;
#[path = "lifecycle_current_user.rs"]
mod lifecycle_current_user;
#[path = "lifecycle_enrichment.rs"]
mod lifecycle_enrichment;
#[path = "lifecycle_friend_baseline.rs"]
mod lifecycle_friend_baseline;
#[path = "lifecycle_friend_messages.rs"]
mod lifecycle_friend_messages;
#[path = "lifecycle_friend_profile.rs"]
mod lifecycle_friend_profile;
#[path = "lifecycle_invite_automation.rs"]
mod lifecycle_invite_automation;
#[path = "lifecycle_output.rs"]
mod lifecycle_output;
#[path = "lifecycle_session.rs"]
mod lifecycle_session;
#[path = "lifecycle_world_cache.rs"]
mod lifecycle_world_cache;
#[path = "message_dispatch.rs"]
mod message_dispatch;
#[cfg(test)]
#[path = "../../../tests/realtime/service/notification_enrichment_tests.rs"]
mod notification_enrichment_tests;
#[path = "persistence.rs"]
mod persistence;
#[cfg(test)]
#[path = "../../../tests/realtime/service/session_reconnect_tests.rs"]
mod session_reconnect_tests;
#[cfg(test)]
#[path = "../../../tests/realtime/service/support.rs"]
mod test_support;
#[path = "types.rs"]
mod types;
#[cfg(test)]
#[path = "../../../tests/realtime/service/world_cache_tests.rs"]
mod world_cache_tests;

use lifecycle_world_cache::WorldNameFetchOutcome;

pub use types::{RealtimeHostRuntime, RealtimeHostRuntimeDeps, RealtimeStopRequest};
