use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvatarEndpointInput {
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvatarIdInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) avatar_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvatarListByUserInput {
    #[serde(default)]
    pub(crate) endpoint: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvatarFileInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) file_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvatarSaveInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) avatar_id: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvatarImpostorCreateInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) avatar_id: String,
    #[serde(default)]
    pub(crate) empty_body: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAvatarModerationInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) avatar_id: String,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
}
