use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendToolsCalendarListInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) params: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendToolsCalendarGroupInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendToolsCalendarEventInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) event_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendToolsFollowGroupEventInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) event_id: String,
    #[serde(default)]
    pub(crate) is_following: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendToolsUserNoteSaveInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) target_user_id: String,
    #[serde(default)]
    pub(crate) note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendToolsUserReportInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) content_type: String,
    #[serde(default)]
    pub(crate) reason: String,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendToolsInviteMessagesInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) current_user_id: String,
    #[serde(default)]
    pub(crate) message_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendToolsInviteMessageEditInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) current_user_id: String,
    #[serde(default)]
    pub(crate) message_type: String,
    #[serde(default)]
    pub(crate) slot: String,
    #[serde(default)]
    pub(crate) message: String,
}
