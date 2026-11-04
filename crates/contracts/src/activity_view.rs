use serde::{Deserialize, Serialize};
use vrcx_0_core::OwnerId;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityViewBuildInput {
    pub owner_user_id: OwnerId,
    pub target_user_id: String,
    pub is_self: bool,
    pub range_days: i64,
    pub utc_offset_minutes: i64,
    pub now_ms: i64,
    pub force_refresh: bool,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityViewOutput {
    pub raw_buckets: Vec<f64>,
    pub normalized_buckets: Vec<f64>,
    pub peak_day_index: i32,
    pub peak_hour_start: i32,
    pub peak_hour_end: i32,
    pub filtered_event_count: i64,
    pub has_any_data: bool,
    pub built_from_cursor: String,
    pub built_at: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityOverlapViewBuildInput {
    pub owner_user_id: OwnerId,
    pub current_user_id: String,
    pub target_user_id: String,
    pub range_days: i64,
    pub utc_offset_minutes: i64,
    pub now_ms: i64,
    pub force_refresh: bool,
    #[serde(default)]
    pub exclude_start_hour: Option<i32>,
    #[serde(default)]
    pub exclude_end_hour: Option<i32>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityOverlapViewOutput {
    pub raw_buckets: Vec<f64>,
    pub normalized_buckets: Vec<f64>,
    pub overlap_percent: i32,
    pub best_day_index: i32,
    pub best_hour_start: i32,
    pub best_hour_end: i32,
    pub has_overlap_data: bool,
    pub built_from_cursor: String,
    pub built_at: String,
}
