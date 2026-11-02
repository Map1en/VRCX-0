use serde::{Deserialize, Serialize};

use super::{ActivityBucket, TimeWindow};
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BestTimeToPlayInput {
    pub owner_user_id: OwnerId,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub bucket: ActivityBucket,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub utc_offset_minutes: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BestTimeToPlayOutput {
    pub rows: Vec<BestTimeBucketRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BestTimeBucketRow {
    pub bucket: String,
    pub label: String,
    pub distinct_friends: usize,
    pub online_events: i64,
    pub top_friends: Vec<BestTimeFriend>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BestTimeFriend {
    #[serde(skip_serializing, default)]
    pub user_id: String,
    pub display_name: String,
    pub online_events: i64,
}
