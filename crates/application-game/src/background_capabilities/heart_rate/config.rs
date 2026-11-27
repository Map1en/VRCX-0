use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const HEART_RATE_CONFIG_KEY: &str = "heartRateConfig";
pub const HEART_RATE_PARAMETERS_CONFIG_KEY: &str = "heartRateParameters";

const MAX_NAMES_PER_SLOT: usize = 8;
const MAX_NAME_CHARS: usize = 64;
const FORBIDDEN_NAME_CHARS: &[char] = &['#', '*', ',', '?', '[', ']', '{', '}'];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HeartRateConfig {
    pub enabled: bool,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub send_parameters: bool,
}

impl Default for HeartRateConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            device_id: None,
            device_name: None,
            send_parameters: true,
        }
    }
}

impl HeartRateConfig {
    pub fn from_stored(raw: &str) -> Self {
        serde_json::from_str(raw).unwrap_or_default()
    }

    pub fn connect(self) -> Self {
        Self {
            enabled: true,
            device_id: None,
            device_name: None,
            ..self
        }
    }

    pub fn sends_parameters(&self, chatbox_enabled: bool) -> bool {
        self.enabled && self.send_parameters && chatbox_enabled
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
            ..self
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HeartRateParameters {
    pub value: Vec<String>,
    pub beat: Vec<String>,
    pub connected: Vec<String>,
    pub percent: Vec<String>,
}

impl Default for HeartRateParameters {
    fn default() -> Self {
        Self {
            value: vec!["HR".into()],
            beat: vec!["isHRBeat".into()],
            connected: Vec::new(),
            percent: Vec::new(),
        }
    }
}

impl HeartRateParameters {
    pub fn from_stored(raw: &str) -> Self {
        let Ok(Value::Object(mut stored)) = serde_json::from_str::<Value>(raw) else {
            return Self::default();
        };
        if let Ok(Value::Object(defaults)) = serde_json::to_value(Self::default()) {
            for (key, value) in defaults {
                stored.entry(key).or_insert(value);
            }
        }
        serde_json::from_value::<Self>(Value::Object(stored))
            .map(Self::normalized)
            .unwrap_or_default()
    }

    pub fn normalized(self) -> Self {
        Self {
            value: normalized_names(self.value),
            beat: normalized_names(self.beat),
            connected: normalized_names(self.connected),
            percent: normalized_names(self.percent),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HeartRateParametersEditor {
    pub parameters: HeartRateParameters,
    pub defaults: HeartRateParameters,
}

fn normalized_names(names: Vec<String>) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for name in names {
        let name = name.trim().trim_start_matches('/').to_string();
        let valid = !name.is_empty()
            && name.chars().count() <= MAX_NAME_CHARS
            && !name
                .chars()
                .any(|c| c.is_whitespace() || FORBIDDEN_NAME_CHARS.contains(&c));
        if valid && !kept.contains(&name) {
            kept.push(name);
        }
        if kept.len() == MAX_NAMES_PER_SLOT {
            break;
        }
    }
    kept
}
