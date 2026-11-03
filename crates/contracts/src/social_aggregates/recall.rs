use serde::{Deserialize, Serialize};

use super::TimeWindow;
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecallEncounterInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub name_query: Option<String>,
    #[serde(default)]
    pub world_id: Option<String>,
    #[serde(default)]
    pub co_present_with_user_id: Option<String>,
    #[serde(default)]
    pub target_user_id: Option<String>,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecallEncounterOutput {
    pub rows: Vec<RecallEncounterRow>,
    pub summary: String,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecallEncounterRow {
    pub user_id: String,
    pub display_name: String,
    pub encounter_count: i64,
    pub encounter_days: usize,
    pub first_seen: String,
    pub last_seen: String,
    pub is_friend: bool,
    pub sample_worlds: Vec<String>,
}
