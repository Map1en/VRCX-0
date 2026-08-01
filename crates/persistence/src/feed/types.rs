use serde::{Deserialize, Serialize};
use vrcx_0_core::json::RawJson;

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedCursorInput {
    pub created_at: String,
    pub source_rank: i64,
    pub row_id: i64,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowsQueryInput {
    pub user_id: String,
    pub mode: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub vip_list: Vec<String>,
    #[serde(default)]
    pub excluded_user_ids: Vec<String>,
    pub max_entries: i64,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub cursor: Option<FeedCursorInput>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedLiveEntryInput {
    pub sequence: i64,
    #[serde(default)]
    pub entry: RawJson,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedReadModelQueryInput {
    pub user_id: String,
    pub mode: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub vip_list: Vec<String>,
    #[serde(default)]
    pub max_entries: i64,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub cursor: Option<FeedCursorInput>,
    #[serde(default)]
    pub live_entries: Vec<FeedLiveEntryInput>,
    #[serde(default)]
    pub min_live_sequence: i64,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub excluded_user_ids: Vec<String>,
    #[serde(default)]
    pub max_rows: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedLiveRowsMergeInput {
    #[serde(default)]
    pub rows: Vec<RawJson>,
    #[serde(default)]
    pub current_user_id: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub excluded_user_ids: Vec<String>,
    #[serde(default)]
    pub live_entries: Vec<FeedLiveEntryInput>,
    #[serde(default)]
    pub min_live_sequence: i64,
    #[serde(default)]
    pub max_rows: i64,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedReadModelOutput {
    pub rows: Vec<FeedRowOutput>,
    pub max_sequence: i64,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_rank: Option<i64>,
    #[serde(rename = "created_at")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_avatar_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_avatar_thumbnail_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_avatar_tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_avatar_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_current_avatar_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_current_avatar_thumbnail_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_current_avatar_tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<String>,
}
