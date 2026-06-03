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
use vrcx_0_persistence::worlds::world_cache_get;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::auth::current_user_get_input;
use vrcx_0_vrchat_client::http_api::ApiScope;
use vrcx_0_vrchat_client::realtime::normalize_websocket_domain;
use vrcx_0_vrchat_client::users as remote_users;

use crate::event_bus::RuntimeEventBus;
use crate::game_log::RuntimeSnapshot;
use crate::overlay_activity::OverlayActivityRuntime;
use crate::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::realtime::connection::{
    run_realtime_transport, RealtimeMessageSink, RealtimeTransportDeps,
};
use crate::realtime::current_user::RealtimeCurrentUserRuntime;
use crate::realtime::friends::{is_friend_event_type, RealtimeFriendsRuntime};
use crate::realtime::instance_queue::apply_instance_queue_ws_message;
use crate::realtime::notifications::{
    apply_instance_closed_ws_message, apply_notification_ws_message,
};
use crate::realtime::{
    FriendBaselineResult, FriendProjection, PendingOfflineTimerAction,
    RealtimeCurrentUserAuthority, RealtimeCurrentUserOutput, RealtimeFriendApplyResult,
    RealtimeFriendOutput, RealtimeInstanceClosedOutput, RealtimeNotificationOutput,
    RealtimeNotificationProjection, RealtimeSessionContext, RealtimeTransportStartResult,
    RealtimeWsStatusPayload,
};
use crate::session::HostSessionRuntime;
use crate::sync::RuntimeSyncEngine;
use crate::task_supervisor::TaskSupervisor;
use crate::web_client::WebClient;
use crate::{Error, Result};

#[path = "lifecycle.rs"]
mod lifecycle;
#[path = "message_dispatch.rs"]
mod message_dispatch;
#[path = "persistence.rs"]
mod persistence;
#[path = "types.rs"]
mod types;

pub use types::{RealtimeHostRuntime, RealtimeHostRuntimeDeps, RealtimeStopRequest};
