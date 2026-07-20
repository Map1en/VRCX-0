use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatWorldIdInput {
    #[serde(default)]
    pub(crate) world_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatWorldListByUserInput {
    #[serde(default)]
    pub(crate) user_id: String,
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
pub struct VrchatWorldSaveInput {
    #[serde(default)]
    pub(crate) world_id: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatWorldPersistentDataDeleteInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) world_id: String,
}
