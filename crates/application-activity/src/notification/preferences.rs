use serde::{Deserialize, Serialize};
use vrcx_0_application_core::ConfigStore;

use super::generic_webhook::{default_webhook_fields, is_default_webhook_field};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationWebhookFormat {
    #[default]
    Generic,
    Discord,
}

impl NotificationWebhookFormat {
    pub(super) fn from_config(value: &str) -> Self {
        match value {
            "discord" => Self::Discord,
            _ => Self::Generic,
        }
    }
}

pub(super) struct NotificationWebhookPreferences {
    pub enabled: bool,
    pub url: String,
    pub format: NotificationWebhookFormat,
    pub fields: Vec<String>,
    pub show_instance_id_in_location: bool,
}

pub(super) fn load_webhook_preferences(config: &dyn ConfigStore) -> NotificationWebhookPreferences {
    NotificationWebhookPreferences {
        enabled: config_bool(config, "webhookEnabled", false),
        url: config_string(config, "webhookUrl", ""),
        format: NotificationWebhookFormat::from_config(&config_string(
            config,
            "webhookFormat",
            "generic",
        )),
        fields: parse_webhook_fields(&config_string(config, "webhookFields", "")),
        show_instance_id_in_location: config_bool(config, "VRCX_showInstanceIdInLocation", false),
    }
}

fn config_string(config: &dyn ConfigStore, key: &str, default_value: &str) -> String {
    config
        .get_string(key, default_value)
        .unwrap_or_else(|_| default_value.to_string())
}

pub fn config_bool(config: &dyn ConfigStore, key: &str, default_value: bool) -> bool {
    config.get_bool(key, default_value).unwrap_or(default_value)
}

pub fn parse_webhook_fields(value: &str) -> Vec<String> {
    let fields = value.trim();
    if fields.is_empty() {
        return default_webhook_fields();
    }
    let parsed = if fields.starts_with('[') {
        serde_json::from_str::<Vec<String>>(fields).unwrap_or_default()
    } else {
        fields.split(',').map(str::to_string).collect()
    };
    let mut selected = Vec::new();
    for field in parsed {
        let field = field.trim();
        if is_default_webhook_field(field) && !selected.iter().any(|item| item == field) {
            selected.push(field.to_string());
        }
    }
    if selected.is_empty() {
        default_webhook_fields()
    } else {
        selected
    }
}
