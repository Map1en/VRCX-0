use serde::{Deserialize, Serialize};

use super::TimeWindow;
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompanionsOfInput {
    pub owner_user_id: OwnerId,
    pub user_id: String,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompanionsOfOutput {
    pub rows: Vec<CompanionOfRow>,
    pub summary: String,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompanionOfRow {
    pub user_id: String,
    pub display_name: String,
    pub is_friend: bool,
    pub overlap_minutes: i64,
    pub shared_instances: usize,
    pub last_seen_together: String,
    pub top_worlds: Vec<String>,
}
