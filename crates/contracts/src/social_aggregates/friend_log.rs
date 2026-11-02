use serde::{Deserialize, Serialize};

use super::TimeWindow;
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub target_user_id: Option<String>,
    #[serde(default)]
    pub types: Vec<String>,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogOutput {
    pub rows: Vec<FriendLogRow>,
    pub summary: String,
    pub total_rows: usize,
    pub returned_rows: usize,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogRow {
    pub created_at: String,
    pub kind: String,
    pub user_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub previous_display_name: String,
    pub trust_level: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub previous_trust_level: String,
    pub friend_number: i64,
}
