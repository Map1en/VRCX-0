use serde::{Deserialize, Serialize};
use vrcx_0_core::OwnerId;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum BrowseHistoryEntityKind {
    User,
    World,
    Avatar,
    Group,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowseHistoryRecordInput {
    pub owner_user_id: OwnerId,
    pub entity_kind: BrowseHistoryEntityKind,
    pub entity_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub image_url: String,
    #[serde(default = "default_record_visit")]
    pub record_visit: bool,
}

fn default_record_visit() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowseHistoryCursor {
    pub last_viewed_at: String,
    pub entity_kind: BrowseHistoryEntityKind,
    pub entity_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowseHistoryQueryInput {
    pub owner_user_id: OwnerId,
    pub entity_kind: Option<BrowseHistoryEntityKind>,
    #[serde(default)]
    pub search: String,
    pub cursor: Option<BrowseHistoryCursor>,
    #[serde(default)]
    pub limit: i64,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowseHistoryItemOutput {
    pub entity_kind: BrowseHistoryEntityKind,
    pub entity_id: String,
    pub title: String,
    pub image_url: String,
    pub first_viewed_at: String,
    pub last_viewed_at: String,
    pub view_count: i64,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowseHistoryPageOutput {
    pub items: Vec<BrowseHistoryItemOutput>,
    pub next_cursor: Option<BrowseHistoryCursor>,
}
