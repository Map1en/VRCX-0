use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendExternalAvatarSearchInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) vrcx_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendExternalTranslationInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) method: String,
    #[serde(default)]
    pub(crate) headers: HashMap<String, String>,
    #[serde(default)]
    pub(crate) body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendExternalYoutubeVideoInput {
    #[serde(default)]
    pub(crate) video_id: String,
    #[serde(default)]
    pub(crate) api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendExternalVrcStatusInput {
    #[serde(default)]
    pub(crate) path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendExternalUrlInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendExternalImageInput {
    #[serde(default)]
    pub(crate) url: String,
}
