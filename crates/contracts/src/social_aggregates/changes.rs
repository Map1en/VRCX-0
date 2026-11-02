use serde::{Deserialize, Serialize};

use super::TimeWindow;
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FriendChangeKind {
    #[default]
    Status,
    Avatar,
    Bio,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendChangesInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub target_user_id: Option<String>,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub kind: FriendChangeKind,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendChangesOutput {
    pub rows: Vec<FriendChangeRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendChangeRow {
    pub user_id: String,
    pub display_name: String,
    pub change_count: i64,
    pub last_changed_at: String,
    pub recent_events: Vec<FriendChangeEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendChangeEvent {
    pub changed_at: String,
    #[serde(skip_serializing, default)]
    pub kind: FriendChangeKind,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub previous_value: String,
    pub new_value: String,
}
