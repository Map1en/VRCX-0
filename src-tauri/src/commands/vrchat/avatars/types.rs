use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAvatarIdInput {
    #[serde(default)]
    pub(crate) avatar_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAvatarListByUserInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) user: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) sort: String,
    #[serde(default)]
    pub(crate) order: String,
    #[serde(default)]
    pub(crate) release_status: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAvatarFileInput {
    #[serde(default)]
    pub(crate) file_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAvatarSaveInput {
    #[serde(default)]
    pub(crate) avatar_id: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAvatarImpostorCreateInput {
    #[serde(default)]
    pub(crate) avatar_id: String,
    #[serde(default)]
    pub(crate) empty_body: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAvatarModerationInput {
    #[serde(default)]
    pub(crate) avatar_id: String,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
}
