use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWriteEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReadEntry {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ConfigKey(String);

impl ConfigKey {
    pub fn new(key: &str) -> Self {
        Self(resolve_config_key(key))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for ConfigKey {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for ConfigKey {
    fn from(value: String) -> Self {
        Self::new(&value)
    }
}

pub(super) fn resolve_config_key(key: &str) -> String {
    if key.starts_with("config:") {
        return key.to_string();
    }

    let stripped = key.strip_prefix("VRCX_").unwrap_or(key);
    format!("config:vrcx_{}", stripped.to_lowercase())
}
