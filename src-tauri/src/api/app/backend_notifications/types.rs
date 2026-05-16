use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendNotificationMarkSeenInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) version: i64,
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendNotificationIdInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendNotificationHideInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) version: i64,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
    #[serde(default)]
    pub(crate) sender_user_id: String,
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendNotificationRespondInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) response_type: String,
    #[serde(default)]
    pub(crate) response_data: Value,
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInviteResponseInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) response_slot: i64,
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInviteResponsePhotoInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) response_slot: i64,
    #[serde(default)]
    pub(crate) image_data: String,
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendNotificationSendInput {
    #[serde(default)]
    pub(crate) receiver_user_id: String,
    #[serde(default)]
    pub(crate) params: Value,
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendBoopInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) emoji_id: String,
    #[serde(default)]
    pub(crate) endpoint: String,
}
