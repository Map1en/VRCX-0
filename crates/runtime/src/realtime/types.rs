use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use vrcx_0_core::friends::FriendRecord;
pub use vrcx_0_core::realtime::{
    RealtimeSessionContext, RealtimeWsMessagePayload, RealtimeWsStatusPayload,
};
use vrcx_0_store::realtime::RealtimePersistenceBatch;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friends_by_id: HashMap<String, FriendRecord>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendBaselineResult {
    pub accepted: bool,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friend_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeTransportStartResult {
    pub generation: u64,
    pub client_run_id: u64,
    pub session_generation: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendProjectionPatch {
    pub user_id: String,
    pub patch: Value,
    pub state_bucket: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendProjection {
    pub generation: u64,
    pub baseline_revision: u64,
    #[serde(default)]
    pub patches: Vec<FriendProjectionPatch>,
    #[serde(default)]
    pub removals: Vec<String>,
    #[serde(default)]
    pub feed_entries: Vec<Value>,
    pub friend_log_changed: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendOutput {
    pub owner_user_id: String,
    pub projection: FriendProjection,
    pub persistence: RealtimePersistenceBatch,
    pub timer_action: PendingOfflineTimerAction,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeNotificationOutput {
    pub owner_user_id: String,
    pub projection: RealtimeNotificationProjection,
    pub persistence: RealtimePersistenceBatch,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeCurrentUserOutput {
    pub owner_user_id: String,
    pub projection: RealtimeCurrentUserProjection,
    pub persistence: RealtimePersistenceBatch,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeInstanceClosedOutput {
    pub projection: RealtimeInstanceClosedProjection,
    pub persistence: RealtimePersistenceBatch,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RealtimeCurrentUserAuthority {
    pub is_game_running: bool,
    pub game_log_enabled: bool,
    pub game_log_location: String,
    pub game_log_destination: String,
    pub game_log_world_name: String,
}

pub enum RealtimeFriendApplyResult {
    Output(Box<RealtimeFriendOutput>),
    MissingBaseline,
    Ignored,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum PendingOfflineTimerAction {
    #[default]
    None,
    Schedule {
        user_id: String,
        token: u64,
        delay_ms: u64,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeNotificationUpsert {
    pub notification: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub insert_defaults: Option<Value>,
    pub notify_menu: bool,
    pub deliver_runtime: bool,
    pub run_automation: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeNotificationProjection {
    pub generation: u64,
    #[serde(default)]
    pub upserts: Vec<RealtimeNotificationUpsert>,
    #[serde(default)]
    pub expired_ids: Vec<String>,
    #[serde(default)]
    pub seen_ids: Vec<String>,
    pub clear_menu_if_no_unseen: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeCurrentUserProjection {
    pub generation: u64,
    pub patch: Value,
    pub snapshot: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_state_patch: Option<Value>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeInstanceClosedProjection {
    pub generation: u64,
    pub notification: Value,
    pub feed_entry: Value,
}
