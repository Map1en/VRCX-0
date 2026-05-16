use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthEndpointInput {
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthLoginBasicInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) username: String,
    #[serde(default)]
    pub(crate) password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthCodeInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthFileAnalysisInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) file_id: String,
    #[serde(default)]
    pub(crate) version: i64,
    #[serde(default)]
    pub(crate) variant: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthSavedCredentialDeleteInput {
    #[serde(default)]
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthLoginSuccessRecordInput {
    #[serde(default)]
    pub(crate) user: Value,
    #[serde(default)]
    pub(crate) login_params: Value,
    #[serde(default)]
    pub(crate) stored_login_params: Option<Value>,
    #[serde(default)]
    pub(crate) save_credentials: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthLogoutRecordInput {
    #[serde(default)]
    pub(crate) user_or_user_id: Value,
    #[serde(default)]
    pub(crate) clear_last_user_logged_in: Option<bool>,
    #[serde(default)]
    pub(crate) cookies: Option<Value>,
}
