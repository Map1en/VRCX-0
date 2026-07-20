use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatSearchParamsInput {
    #[serde(default)]
    pub(crate) params: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatSearchWorldsInput {
    #[serde(default)]
    pub(crate) params: HashMap<String, Value>,
    pub(crate) option: Option<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatSearchShortNameInput {
    #[serde(default)]
    pub(crate) short_name: String,
}
