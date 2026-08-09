use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivityRefreshMode {
    Full,
    Incremental,
    Expand,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivityViewKind {
    Activity,
    Overlap,
}

impl ActivityViewKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Activity => "activity",
            Self::Overlap => "overlap",
        }
    }
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFriendPresenceSliceInput {
    pub owner_user_id: String,
    pub user_id: String,
    pub from_date_iso: String,
    #[serde(default)]
    pub to_date_iso: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPresenceOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub r#type: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSourceBoundsOutput {
    pub first_created_at: String,
    pub last_created_at: String,
    pub count: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySyncStateOutput {
    pub user_id: String,
    pub updated_at: String,
    pub is_self: bool,
    pub source_last_created_at: String,
    pub pending_session_start_at: Value,
    pub cached_range_days: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionOutput {
    pub start: i64,
    pub end: i64,
    pub is_open_tail: bool,
    pub source_revision: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSessionsRefreshInput {
    pub user_id: String,
    pub mode: ActivityRefreshMode,
    #[serde(default)]
    pub range_days: Value,
    #[serde(default)]
    pub now_ms: Option<i64>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSessionsRefreshOutput {
    pub sync: ActivitySyncStateOutput,
    pub sessions: Vec<ActivitySessionOutput>,
    pub source_count: usize,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheQueryInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    pub range_days: Value,
    pub view_kind: ActivityViewKind,
    #[serde(default)]
    pub exclude_key: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheOutput {
    pub owner_user_id: String,
    pub target_user_id: String,
    pub range_days: i64,
    pub view_kind: ActivityViewKind,
    pub exclude_key: String,
    pub bucket_version: i64,
    pub built_from_cursor: String,
    pub raw_buckets: Value,
    pub normalized_buckets: Value,
    pub summary: Value,
    pub built_at: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySyncStateInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub is_self: bool,
    #[serde(default)]
    pub source_last_created_at: String,
    #[serde(default)]
    pub pending_session_start_at: Option<Value>,
    #[serde(default)]
    pub cached_range_days: Value,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionInput {
    #[serde(default)]
    pub start: Value,
    #[serde(default)]
    pub end: Value,
    #[serde(default)]
    pub is_open_tail: bool,
    #[serde(default)]
    pub source_revision: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    pub range_days: Value,
    pub view_kind: ActivityViewKind,
    #[serde(default)]
    pub exclude_key: String,
    #[serde(default)]
    pub bucket_version: Value,
    #[serde(default)]
    pub built_from_cursor: String,
    #[serde(default)]
    pub raw_buckets: Value,
    #[serde(default)]
    pub normalized_buckets: Value,
    #[serde(default)]
    pub summary: Value,
    #[serde(default)]
    pub built_at: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityViewBuildInput {
    pub owner_user_id: String,
    pub target_user_id: String,
    pub is_self: bool,
    pub range_days: i64,
    pub utc_offset_minutes: i64,
    pub now_ms: i64,
    pub force_refresh: bool,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityStatusDistributionOutput {
    pub join_me_count: i64,
    pub active_count: i64,
    pub ask_me_count: i64,
    pub busy_count: i64,
    pub total_count: i64,
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
    pub status_distribution: ActivityStatusDistributionOutput,
    pub built_from_cursor: String,
    pub built_at: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityOverlapViewBuildInput {
    pub owner_user_id: String,
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
