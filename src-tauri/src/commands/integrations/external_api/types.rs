use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiAvatarSearchInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) vrcx_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiTranslationInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) method: String,
    #[serde(default)]
    pub(crate) headers: HashMap<String, String>,
    #[serde(default)]
    pub(crate) body: Value,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiYoutubeVideoInput {
    #[serde(default)]
    pub(crate) video_id: String,
    #[serde(default)]
    pub(crate) api_key: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiUrlInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiImageInput {
    #[serde(default)]
    pub(crate) url: String,
}
