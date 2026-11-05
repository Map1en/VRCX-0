use serde::Serialize;
use vrcx_0_contracts::RuntimeEventPayload;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::{RawJson, RawJsonObject};
use vrcx_0_core::presence::PresenceEntry;

use crate::FriendLocationTime;

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeUserProjection {
    pub users: Vec<RawJson>,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendProjectionPatch {
    pub user_id: String,
    pub record: FriendRecord,
    pub presence: PresenceEntry,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendProjection {
    pub generation: u64,
    pub baseline_revision: u64,
    #[serde(default)]
    pub patches: Vec<FriendProjectionPatch>,
    #[serde(default)]
    pub removals: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location_time_snapshot: Option<Vec<FriendLocationTime>>,
    pub friend_log_changed: bool,
}

impl FriendProjection {
    pub fn new(generation: u64, baseline_revision: u64) -> Self {
        Self {
            generation,
            baseline_revision,
            patches: Vec::new(),
            removals: Vec::new(),
            location_time_snapshot: None,
            friend_log_changed: false,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeNotificationUpsert {
    pub notification: RawJson,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub insert_defaults: Option<RawJson>,
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
    pub patch: RawJsonObject,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_state_patch: Option<RawJsonObject>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeInstanceClosedProjection {
    pub generation: u64,
    pub notification: RawJson,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeInstanceQueueKind {
    Update,
    Ready,
    Left,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeInstanceQueueProjection {
    pub generation: u64,
    pub kind: RealtimeInstanceQueueKind,
    pub instance_location: String,
    pub world_id: String,
    pub world_name: String,
    pub position: i64,
    pub queue_size: i64,
    pub received_at: String,
}

impl RuntimeEventPayload for FriendProjection {
    const EVENT_NAME: &'static str = "realtimeFriendProjection";
}

impl RuntimeEventPayload for RealtimeUserProjection {
    const EVENT_NAME: &'static str = "realtimeUserProjection";
}

impl RuntimeEventPayload for RealtimeNotificationProjection {
    const EVENT_NAME: &'static str = "realtimeNotificationProjection";
}

impl RuntimeEventPayload for RealtimeEntryCorrection {
    const EVENT_NAME: &'static str = "realtimeEntryCorrection";
}

impl RuntimeEventPayload for RealtimeCurrentUserProjection {
    const EVENT_NAME: &'static str = "realtimeCurrentUserProjection";
}

impl RuntimeEventPayload for RealtimeInstanceClosedProjection {
    const EVENT_NAME: &'static str = "realtimeInstanceClosedProjection";
}

impl RuntimeEventPayload for RealtimeInstanceQueueProjection {
    const EVENT_NAME: &'static str = "realtimeInstanceQueueProjection";
}
