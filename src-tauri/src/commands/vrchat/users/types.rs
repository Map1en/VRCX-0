use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatUserInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) force: bool,
    #[serde(default)]
    pub(crate) dialog: bool,
    #[serde(default)]
    pub(crate) is_friend: Option<bool>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatUserMutualFriendsInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) include_user_id_param: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatCurrentUserUpdateInput {
    #[serde(default)]
    pub(crate) user_id: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatCurrentUserBadgeInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) badge_id: String,
    #[serde(default)]
    pub(crate) hidden: bool,
    #[serde(default)]
    pub(crate) showcased: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatCurrentUserTagsInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
}
