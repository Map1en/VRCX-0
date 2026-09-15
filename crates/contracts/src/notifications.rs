use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowsQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub filters: Vec<String>,
    pub per_table_limit: i64,
    #[serde(default)]
    pub include_unseen: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct NotificationV1RowOutput {
    pub id: String,
    pub created_at: String,
    pub r#type: String,
    pub sender_user_id: String,
    pub sender_username: String,
    pub receiver_user_id: String,
    pub message: String,
    pub world_id: String,
    pub world_name: String,
    pub image_url: String,
    pub invite_message: String,
    pub request_message: String,
    pub response_message: String,
    pub location: String,
    pub expired: i64,
    pub seen: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct NotificationV2RowOutput {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub r#type: String,
    pub link: String,
    pub link_text: String,
    pub message: String,
    pub title: String,
    pub image_url: String,
    pub seen: i64,
    pub sender_user_id: String,
    pub sender_username: String,
    pub data: String,
    pub responses: String,
    pub details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowsOutput {
    pub v1_rows: Vec<NotificationV1RowOutput>,
    pub v2_rows: Vec<NotificationV2RowOutput>,
    pub unseen_v2_rows: Vec<NotificationV2RowOutput>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub per_table_limit: i64,
    #[serde(default)]
    pub limit: i64,
    #[serde(default)]
    pub include_unseen: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListItemOutput {
    pub id: String,
    pub version: i64,
    pub created_at: String,
    #[serde(rename = "created_at")]
    pub created_at_legacy: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub updated_at: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub expires_at: String,
    pub r#type: String,
    pub link: String,
    pub link_text: String,
    pub message: String,
    pub title: String,
    pub image_url: String,
    pub seen: bool,
    pub sender_user_id: String,
    pub sender_username: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub receiver_user_id: String,
    pub data: Value,
    pub responses: Value,
    pub details: Value,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub location: String,
    pub expired: bool,
}
