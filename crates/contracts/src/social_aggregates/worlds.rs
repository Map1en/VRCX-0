use serde::{Deserialize, Serialize};
use vrcx_0_core::FavoriteEntityKind;

use super::TimeWindow;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorldsVisitedInput {
    pub time_window: TimeWindow,
    pub limit: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorldsVisitedOutput {
    pub rows: Vec<VisitedWorldRow>,
    pub summary: String,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisitedWorldRow {
    pub world_id: String,
    pub world_name: String,
    #[serde(skip_serializing, default)]
    pub location: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub access_type: String,
    pub visited_at: String,
    pub left_at: Option<String>,
    pub stay_minutes: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub people: Option<Vec<String>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorldVisitHistory {
    pub visits: i64,
    pub total_minutes: i64,
    pub first_visited_at: String,
    pub last_visited_at: String,
    pub recent_visits: Vec<VisitedWorldRow>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisitedWorldMatch {
    pub world_id: String,
    pub world_name: String,
    pub last_visited_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TopVisitedWorldsInput {
    pub time_window: TimeWindow,
    pub limit: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TopVisitedWorldRow {
    pub world_id: String,
    pub world_name: String,
    pub visits: i64,
    pub total_minutes: i64,
    pub last_visited_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteLocalInput {
    pub kind: FavoriteEntityKind,
    pub entity_id: String,
    pub group: String,
    #[serde(default)]
    pub action: FavoriteAction,
    #[serde(default = "default_true")]
    pub dry_run: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteOutput {
    pub kind: FavoriteEntityKind,
    pub entity_id: String,
    pub group: String,
    pub action: FavoriteAction,
    pub dry_run: bool,
    pub affected_rows: i64,
    pub caveats: Vec<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteAction {
    #[default]
    Add,
    Remove,
}
