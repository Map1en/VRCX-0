use vrcx_0_application_core::ConfigStore;

use super::{
    NotificationDeliveryCondition, NotificationDeliveryPreferences, NotificationTtsNameMode,
};

const LEGACY_OVERLAY_NOTIFICATION_KEYS: [(&str, &str); 6] = [
    ("VRCX-0_xsNotifications", "xsNotifications"),
    ("VRCX-0_ovrtHudNotifications", "ovrtHudNotifications"),
    ("VRCX-0_ovrtWristNotifications", "ovrtWristNotifications"),
    ("VRCX-0_imageNotifications", "imageNotifications"),
    ("VRCX-0_notificationTimeout", "notificationTimeout"),
    ("VRCX-0_notificationOpacity", "notificationOpacity"),
];

pub fn load_preferences(config: &dyn ConfigStore) -> NotificationDeliveryPreferences {
    NotificationDeliveryPreferences {
        desktop_toast: NotificationDeliveryCondition::from_config(&config_string(
            config,
            "desktopToast",
            "Never",
        )),
        afk_desktop_toast: config_bool(config, "afkDesktopToast", false),
        overlay_toast: NotificationDeliveryCondition::from_config(&config_string(
            config,
            "overlayToast",
            "Game Running",
        )),
        desktop_notification_sound: config_bool(config, "desktopNotificationSound", false),
        notification_tts: NotificationDeliveryCondition::from_config(&config_string(
            config,
            "notificationTTS",
            "Never",
        )),
        notification_tts_name_mode: config_tts_name_mode(config),
        notification_tts_voice_native: config_string(config, "notificationTTSVoiceNative", ""),
        notification_tts_volume: config_int(config, "notificationTTSVolume", 100).clamp(0, 100)
            as u8,
        xs_notifications: config_bool(config, "xsNotifications", false),
        ovrt_hud_notifications: config_bool(config, "ovrtHudNotifications", false),
        ovrt_wrist_notifications: config_bool(config, "ovrtWristNotifications", false),
        image_notifications: config_bool(config, "imageNotifications", true),
        desktop_notification_avatars: config_bool(config, "desktopNotificationAvatars", true),
        notification_timeout_ms: config_int(config, "notificationTimeout", 3000),
        notification_opacity_percent: config_int(config, "notificationOpacity", 100),
        show_instance_id_in_location: config_bool(config, "VRCX_showInstanceIdInLocation", false),
    }
}

pub fn config_tts_name_mode(config: &dyn ConfigStore) -> NotificationTtsNameMode {
    let configured = config_string(config, "notificationTTSNameMode", "");
    if !configured.trim().is_empty() {
        return notification_tts_name_mode(&configured);
    }
    if config_bool(config, "notificationTTSNickName", false) {
        NotificationTtsNameMode::Note
    } else {
        NotificationTtsNameMode::Username
    }
}

pub fn migrate_legacy_overlay_notification_keys(
    config: &dyn ConfigStore,
) -> vrcx_0_application_core::Result<()> {
    for (legacy_key, key) in LEGACY_OVERLAY_NOTIFICATION_KEYS {
        let Some(value) = config.get_raw(legacy_key)? else {
            continue;
        };
        if config.get_raw(key)?.is_none() {
            config.set_string(key, &value)?;
        }
        config.remove(legacy_key)?;
    }
    Ok(())
}

pub fn seed_hmd_notifications_default(
    config: &dyn ConfigStore,
) -> vrcx_0_application_core::Result<Option<bool>> {
    if config.get_raw("hmdNotificationsEnabled")?.is_some() {
        return Ok(None);
    }
    let external_overlay_enabled = [
        "xsNotifications",
        "ovrtHudNotifications",
        "ovrtWristNotifications",
    ]
    .into_iter()
    .any(|key| config_bool(config, key, false));
    let enabled = !external_overlay_enabled;
    config.set_bool("hmdNotificationsEnabled", enabled)?;
    Ok(Some(enabled))
}

pub fn notification_tts_name_mode(value: &str) -> NotificationTtsNameMode {
    match value {
        "note" => NotificationTtsNameMode::Note,
        "usernameAndNote" => NotificationTtsNameMode::UsernameAndNote,
        _ => NotificationTtsNameMode::Username,
    }
}

fn config_string(config: &dyn ConfigStore, key: &str, default_value: &str) -> String {
    config
        .get_string(key, default_value)
        .unwrap_or_else(|_| default_value.to_string())
}

fn config_bool(config: &dyn ConfigStore, key: &str, default_value: bool) -> bool {
    config.get_bool(key, default_value).unwrap_or(default_value)
}

fn config_int(config: &dyn ConfigStore, key: &str, default_value: i32) -> i32 {
    config
        .get_raw(key)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<i32>().ok())
        .unwrap_or(default_value)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::test_config;
    use super::{migrate_legacy_overlay_notification_keys, seed_hmd_notifications_default};

    #[test]
    fn legacy_overlay_keys_move_to_their_current_names_once() {
        let (_dir, config) = test_config("legacy-keys");
        config.set_bool("VRCX-0_xsNotifications", true).unwrap();
        config
            .set_string("VRCX-0_notificationTimeout", "9000")
            .unwrap();
        config
            .set_string("VRCX-0_notificationOpacity", "40")
            .unwrap();
        config.set_string("notificationOpacity", "80").unwrap();

        migrate_legacy_overlay_notification_keys(config.as_ref()).unwrap();

        assert!(config.get_bool("xsNotifications", false).unwrap());
        assert_eq!(
            config.get_raw("notificationTimeout").unwrap().as_deref(),
            Some("9000")
        );
        assert_eq!(
            config.get_raw("notificationOpacity").unwrap().as_deref(),
            Some("80")
        );
        assert!(config.get_raw("VRCX-0_xsNotifications").unwrap().is_none());
        assert!(config
            .get_raw("VRCX-0_notificationOpacity")
            .unwrap()
            .is_none());
        assert_eq!(
            seed_hmd_notifications_default(config.as_ref()).unwrap(),
            Some(false)
        );
    }

    #[test]
    fn hmd_default_seed_runs_once() {
        let (_dir, config) = test_config("existing-value");
        config.set_bool("hmdNotificationsEnabled", false).unwrap();

        assert_eq!(
            seed_hmd_notifications_default(config.as_ref()).unwrap(),
            None
        );
        assert!(!config.get_bool("hmdNotificationsEnabled", true).unwrap());
    }

    #[test]
    fn tts_name_mode_preserves_legacy_nickname_setting() {
        let (_dir, config) = test_config("tts-name-mode-legacy");

        config.set_bool("notificationTTSNickName", true).unwrap();
        assert_eq!(
            super::config_tts_name_mode(config.as_ref()),
            super::NotificationTtsNameMode::Note
        );

        config
            .set_string("notificationTTSNameMode", "usernameAndNote")
            .unwrap();
        assert_eq!(
            super::config_tts_name_mode(config.as_ref()),
            super::NotificationTtsNameMode::UsernameAndNote
        );
    }

    #[test]
    fn tts_volume_defaults_and_clamps_persisted_values() {
        let (_dir, config) = test_config("tts-volume");

        assert_eq!(
            super::load_preferences(config.as_ref()).notification_tts_volume,
            100
        );

        config.set_string("notificationTTSVolume", "42").unwrap();
        assert_eq!(
            super::load_preferences(config.as_ref()).notification_tts_volume,
            42
        );

        config.set_string("notificationTTSVolume", "-1").unwrap();
        assert_eq!(
            super::load_preferences(config.as_ref()).notification_tts_volume,
            0
        );

        config.set_string("notificationTTSVolume", "101").unwrap();
        assert_eq!(
            super::load_preferences(config.as_ref()).notification_tts_volume,
            100
        );
    }
}
