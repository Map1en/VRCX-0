use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupQuickModerationInput {
    #[serde(default)]
    pub current_user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    #[serde(default)]
    pub endpoint: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupQuickModerationActionInput {
    #[serde(default)]
    pub current_user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub action: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupQuickModerationGroup {
    pub group_id: String,
    pub name: String,
    pub short_code: String,
    pub icon_url: String,
    pub owner_id: String,
    pub membership_label: String,
    pub role_label: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupQuickModerationOutput {
    pub current_user_id: String,
    pub target_user_id: String,
    pub stale: bool,
    pub kick_groups: Vec<GroupQuickModerationGroup>,
    pub ban_groups: Vec<GroupQuickModerationGroup>,
    pub membership_error_count: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupQuickModerationActionOutput {
    pub group_id: String,
    pub target_user_id: String,
    pub action: String,
    pub status: i32,
}
