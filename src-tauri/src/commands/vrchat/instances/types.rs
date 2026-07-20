use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatInstanceIdentityInput {
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatInstanceShortNameInput {
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
    #[serde(default)]
    pub(crate) short_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatInstanceCreateInput {
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatInstanceSelfInviteInput {
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
    #[serde(default)]
    pub(crate) short_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatInstanceCloseInput {
    #[serde(default)]
    pub(crate) location: String,
    #[serde(default)]
    pub(crate) hard_close: bool,
}
