use serde::{Deserialize, Serialize};

use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageBuildInput {
    pub owner_user_id: OwnerId,
    pub range_days: i64,
    pub utc_offset_minutes: i64,
    pub now_ms: i64,
    pub companion_order: ActivityCompanionOrder,
    pub force_refresh: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivityCompanionOrder {
    #[default]
    Minutes,
    Days,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivitySeriesBucket {
    #[default]
    Day,
    Week,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageSummary {
    pub total_minutes: i64,
    pub window_days: i64,
    pub active_days: i64,
    pub session_count: i64,
    pub longest_session_minutes: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPagePreviousSummary {
    pub total_minutes: i64,
    pub active_days: i64,
    pub has_data: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySeriesPoint {
    pub start_date: String,
    pub minutes: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageSeries {
    pub bucket: ActivitySeriesBucket,
    pub points: Vec<ActivitySeriesPoint>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageAccessSlice {
    pub access: String,
    pub minutes: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageWorldRow {
    pub world_id: String,
    pub world_name: String,
    pub minutes: i64,
    pub visit_count: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageWorlds {
    pub top: Vec<ActivityPageWorldRow>,
    pub distinct_count: i64,
    pub new_world_minutes: i64,
    pub returning_world_minutes: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageCompanionRow {
    pub user_id: String,
    pub display_name: String,
    pub is_friend: bool,
    pub minutes: i64,
    pub co_days: i64,
    pub instances: i64,
    pub last_seen_together: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageFadingRow {
    pub user_id: String,
    pub display_name: String,
    pub prior_minutes: i64,
    pub recent_minutes: i64,
    pub drop_percent: i64,
    pub last_seen_together: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPagePeople {
    pub order: ActivityCompanionOrder,
    pub companions: Vec<ActivityPageCompanionRow>,
    pub strangers: Vec<ActivityPageCompanionRow>,
    pub fading: Vec<ActivityPageFadingRow>,
    pub encountered_count: i64,
    pub new_face_count: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageCoverage {
    pub from: String,
    pub to: String,
    pub first_source_at: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageView {
    pub range_days: i64,
    pub utc_offset_minutes: i64,
    pub window_from_ms: i64,
    pub window_to_ms: i64,
    pub summary: ActivityPageSummary,
    pub previous: ActivityPagePreviousSummary,
    pub series: ActivityPageSeries,
    pub access_split: Vec<ActivityPageAccessSlice>,
    pub worlds: ActivityPageWorlds,
    pub people: ActivityPagePeople,
    pub coverage: ActivityPageCoverage,
    pub built_from_cursor: String,
    pub built_at: String,
    pub stale: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivityLocationSpan {
    pub start_ms: i64,
    pub end_ms: i64,
    pub world_id: String,
    pub world_name: String,
    pub access_bucket: String,
}

#[derive(Clone, Debug)]
pub struct CachedActivityPage {
    pub view: ActivityPageView,
    pub built_from_cursor: String,
    pub payload_version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityJourneyDayInput {
    pub owner_user_id: OwnerId,
    pub from_ms: i64,
    pub to_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityJourneyDaysInput {
    pub owner_user_id: OwnerId,
    pub utc_offset_minutes: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityJourneyCompanion {
    pub user_id: String,
    pub display_name: String,
    pub is_friend: bool,
    pub shared_ms: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityJourneyVisit {
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub world_image_url: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub companions: Vec<ActivityJourneyCompanion>,
}
