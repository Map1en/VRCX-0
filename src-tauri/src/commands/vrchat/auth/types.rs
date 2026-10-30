use serde::Deserialize;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatAuthFileAnalysisInput {
    #[serde(default)]
    pub(crate) file_id: String,
    #[serde(default)]
    pub(crate) version: i64,
    #[serde(default)]
    pub(crate) variant: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatAuthSavedCredentialDeleteInput {
    #[serde(default)]
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatAuthSavedPasswordClearInput {
    #[serde(default)]
    pub(crate) user_id: String,
}
