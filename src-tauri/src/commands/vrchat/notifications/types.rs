use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatNotificationMarkSeenInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) version: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatNotificationIdInput {
    #[serde(default)]
    pub(crate) id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatNotificationHideInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) version: i64,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
    #[serde(default)]
    pub(crate) sender_user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatNotificationRespondInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) response_type: String,
    #[serde(default)]
    pub(crate) response_data: Value,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatInviteResponseInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) response_slot: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatInviteResponsePhotoInput {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) response_slot: i64,
    #[serde(default)]
    pub(crate) image_data: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatNotificationSendInput {
    #[serde(default)]
    pub(crate) receiver_user_id: String,
    #[serde(default)]
    pub(crate) params: Value,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatNotificationPhotoSendInput {
    #[serde(default)]
    pub(crate) receiver_user_id: String,
    #[serde(default)]
    pub(crate) params: Value,
    #[serde(default)]
    pub(crate) image_data: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatBoopInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) emoji_id: String,
}
