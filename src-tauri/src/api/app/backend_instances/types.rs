use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInstanceIdentityInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInstanceShortNameInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
    #[serde(default)]
    pub(crate) short_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInstanceCreateInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInstanceSelfInviteInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
    #[serde(default)]
    pub(crate) short_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInstanceCloseInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) location: String,
    #[serde(default)]
    pub(crate) hard_close: bool,
}
