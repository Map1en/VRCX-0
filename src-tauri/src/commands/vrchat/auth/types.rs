use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAuthEndpointInput {
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAuthFileAnalysisInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) file_id: String,
    #[serde(default)]
    pub(crate) version: i64,
    #[serde(default)]
    pub(crate) variant: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAuthSavedCredentialDeleteInput {
    #[serde(default)]
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum VrchatAuthSessionStartInput {
    #[serde(rename_all = "camelCase")]
    Basic {
        #[serde(default)]
        endpoint: String,
        #[serde(default)]
        username: String,
        #[serde(default)]
        password: String,
        #[serde(default)]
        save_credentials: bool,
    },
    #[serde(rename_all = "camelCase")]
    SavedCredential {
        #[serde(default)]
        endpoint: String,
        #[serde(default)]
        user_id: String,
    },
    CookieRestore {
        #[serde(default)]
        endpoint: String,
    },
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAuthAutoLoginStartInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAuthSessionRespondInput {
    #[serde(default)]
    pub(crate) method: String,
    #[serde(default)]
    pub(crate) code: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAuthLogoutRecordInput {
    #[serde(default)]
    pub(crate) user_or_user_id: Value,
    #[serde(default)]
    pub(crate) clear_last_user_logged_in: Option<bool>,
    #[serde(default)]
    pub(crate) cookies: Option<Value>,
}
