use vrcx_0_persistence::config::ConfigRepository;

use super::generic_webhook::{default_webhook_fields, is_default_webhook_field};
use super::{notification_tts_name_mode, NotificationDeliveryPreferences};

pub(super) fn load_preferences(config: &ConfigRepository) -> NotificationDeliveryPreferences {
    NotificationDeliveryPreferences {
        desktop_toast: config_string(config, "desktopToast", "Never"),
        desktop_notification_sound: config_bool(config, "desktopNotificationSound", false),
        notification_tts: config_string(config, "notificationTTS", "Never"),
        notification_tts_name_mode: config_tts_name_mode(config),
        notification_tts_voice_native: config_string(config, "notificationTTSVoiceNative", ""),
        xs_notifications: config_bool_with_legacy(config, "xsNotifications", false),
        ovrt_hud_notifications: config_bool_with_legacy(config, "ovrtHudNotifications", false),
        ovrt_wrist_notifications: config_bool_with_legacy(config, "ovrtWristNotifications", false),
        image_notifications: config_bool_with_legacy(config, "imageNotifications", true),
        notification_timeout_ms: config_int_with_legacy(config, "notificationTimeout", 3000),
        notification_opacity_percent: config_int_with_legacy(config, "notificationOpacity", 100),
        webhook_enabled: config_bool(config, "webhookEnabled", false),
        webhook_url: config_string(config, "webhookUrl", ""),
        webhook_format: normalize_webhook_format(&config_string(
            config,
            "webhookFormat",
            "generic",
        )),
        webhook_fields: parse_webhook_fields(&config_string(config, "webhookFields", "")),
        show_instance_id_in_location: config_bool(config, "VRCX_showInstanceIdInLocation", false),
    }
}

pub(super) fn config_tts_name_mode(config: &ConfigRepository) -> String {
    let configured = config_string(config, "notificationTTSNameMode", "");
    if !configured.trim().is_empty() {
        return notification_tts_name_mode(&configured).into();
    }
    if config_bool(config, "notificationTTSNickName", false) {
        "note"
    } else {
        "username"
    }
    .into()
}

fn config_string(config: &ConfigRepository, key: &str, default_value: &str) -> String {
    config
        .get_string(key, default_value)
        .unwrap_or_else(|_| default_value.to_string())
}

pub(super) fn config_bool(config: &ConfigRepository, key: &str, default_value: bool) -> bool {
    config.get_bool(key, default_value).unwrap_or(default_value)
}

fn config_bool_with_legacy(config: &ConfigRepository, key: &str, default_value: bool) -> bool {
    if config.get_raw(key).ok().flatten().is_some() {
        return config_bool(config, key, default_value);
    }
    if let Some(legacy_key) = legacy_overlay_notification_key(key) {
        if config.get_raw(legacy_key).ok().flatten().is_some() {
            return config_bool(config, legacy_key, default_value);
        }
    }
    default_value
}

fn config_int_with_legacy(config: &ConfigRepository, key: &str, default_value: i32) -> i32 {
    if let Some(raw) = config.get_raw(key).ok().flatten() {
        return parse_config_int(&raw, default_value);
    }
    if let Some(legacy_key) = legacy_overlay_notification_key(key) {
        if let Some(raw) = config.get_raw(legacy_key).ok().flatten() {
            return parse_config_int(&raw, default_value);
        }
    }
    default_value
}

fn parse_config_int(value: &str, default_value: i32) -> i32 {
    value.trim().parse::<i32>().unwrap_or(default_value)
}

fn legacy_overlay_notification_key(key: &str) -> Option<&'static str> {
    match key {
        "xsNotifications" => Some("VRCX-0_xsNotifications"),
        "ovrtHudNotifications" => Some("VRCX-0_ovrtHudNotifications"),
        "ovrtWristNotifications" => Some("VRCX-0_ovrtWristNotifications"),
        "imageNotifications" => Some("VRCX-0_imageNotifications"),
        "notificationTimeout" => Some("VRCX-0_notificationTimeout"),
        "notificationOpacity" => Some("VRCX-0_notificationOpacity"),
        _ => None,
    }
}

fn normalize_webhook_format(value: &str) -> String {
    if value == "discord" {
        "discord".into()
    } else {
        "generic".into()
    }
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
