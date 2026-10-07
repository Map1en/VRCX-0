use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::TimeWindow;
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CopresenceGroupBy {
    #[default]
    Friend,
    FriendWorld,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CopresenceOrderBy {
    #[default]
    TotalMinutes,
    CoDays,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CopresenceAudience {
    #[default]
    Everyone,
    Friends,
    Strangers,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopresenceSummaryInput {
    pub time_window: TimeWindow,
    #[serde(default)]
    pub group_by: CopresenceGroupBy,
    #[serde(default)]
    pub order_by: CopresenceOrderBy,
    #[serde(default)]
    pub min_minutes: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub owner_user_id: Option<OwnerId>,
    #[serde(default)]
    pub audience: CopresenceAudience,
    #[serde(default)]
    pub utc_offset_minutes: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopresenceSummaryOutput {
    pub rows: Vec<CopresenceSummaryRow>,
    pub total_rows: usize,
    pub returned_rows: usize,
    pub truncated: bool,
    pub summary: String,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopresenceSummaryRow {
    pub user_id: String,
    pub display_name: String,
    pub is_friend: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_name: Option<String>,
    pub total_minutes: i64,
    pub co_days: usize,
    pub instances: usize,
    pub last_seen_together: String,
    pub minutes_by_access: BTreeMap<String, i64>,
}
