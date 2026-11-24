use serde::{Deserialize, Serialize};

pub const HEART_RATE_CONFIG_KEY: &str = "heartRateConfig";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HeartRateConfig {
    pub enabled: bool,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
}

impl HeartRateConfig {
    pub fn from_stored(raw: &str) -> Self {
        serde_json::from_str(raw).unwrap_or_default()
    }

    pub fn connect() -> Self {
        Self {
            enabled: true,
            device_id: None,
            device_name: None,
        }
    }

    pub fn disconnected(self) -> Self {
        Self {
            enabled: false,
            ..self
        }
    }

    pub fn forget_device(self) -> Self {
        Self {
            enabled: false,
            device_id: None,
            device_name: None,
        }
    }

    pub fn remembering(self, device_id: String, device_name: Option<String>) -> Self {
        Self {
            device_id: Some(device_id),
            device_name,
            ..self
        }
    }
}
