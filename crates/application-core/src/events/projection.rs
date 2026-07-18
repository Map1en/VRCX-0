use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeProjectionSource {
    FriendProfileBulkLoad,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeUserProjection {
    pub users: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<RealtimeProjectionSource>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendProjectionPatch {
    pub user_id: String,
    pub patch: Value,
    pub state_bucket: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_bucket_authority: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendProjection {
    pub generation: u64,
    pub baseline_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<RealtimeProjectionSource>,
    #[serde(default)]
    pub patches: Vec<FriendProjectionPatch>,
    #[serde(default)]
    pub removals: Vec<String>,
    #[serde(default)]
    pub feed_entries: Vec<Value>,
    pub friend_log_changed: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeNotificationUpsert {
    pub notification: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub insert_defaults: Option<Value>,
    pub notify_menu: bool,
    pub deliver_runtime: bool,
    pub run_automation: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeEntryCorrectionStream {
    Feed,
    Notification,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeEntryCorrectionFields {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_location: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeEntryCorrection {
    pub stream: RealtimeEntryCorrectionStream,
    pub id: String,
    pub fields: RealtimeEntryCorrectionFields,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeCurrentUserProjection {
    pub generation: u64,
    pub patch: Map<String, Value>,
    pub snapshot: Map<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_state_patch: Option<Map<String, Value>>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeInstanceClosedProjection {
    pub generation: u64,
    pub notification: Value,
    pub feed_entry: Value,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeInstanceQueueProjection {
    pub generation: u64,
    pub kind: String,
    pub instance_location: String,
    pub world_id: String,
    pub world_name: String,
    pub position: i64,
    pub queue_size: i64,
    pub received_at: String,
}
