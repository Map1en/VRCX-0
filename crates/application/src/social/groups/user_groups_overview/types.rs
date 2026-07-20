use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserGroupsOverviewInput {
    #[serde(default)]
    pub current_user_id: String,
    #[serde(default)]
    pub endpoint: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserGroupsOverviewGroup {
    pub group_id: String,
    pub name: String,
    pub short_code: Option<String>,
    pub icon_url: Option<String>,
    pub member_count: Option<i64>,
    pub permissions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserGroupsOverviewOutput {
    pub current_user_id: String,
    pub groups: Vec<UserGroupsOverviewGroup>,
    pub permissions_degraded: bool,
}
