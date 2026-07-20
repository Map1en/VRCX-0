use serde::Deserialize;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatAuthFileAnalysisInput {
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
