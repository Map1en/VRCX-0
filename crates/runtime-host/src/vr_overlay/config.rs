use vrcx_0_host::vr_overlay::OverlayActivationButton;
use vrcx_0_persistence::config::ConfigRepository;

use super::eligibility::WristOverlayStartMode;
use super::localization::OverlayLocale;
use super::runtime::{
    HmdNotificationConfig, HmdNotificationPosition, VrOverlayRuntimeConfig, WristOverlayHand,
};
use super::service::OverlayBackendPreference;
use super::{WristOverlayRenderOptions, WristOverlaySizePreset};

pub const VR_OVERLAY_ENABLED_CONFIG_KEY: &str = "wristOverlayEnabled";
pub const VR_OVERLAY_BACKEND_CONFIG_KEY: &str = "wristOverlayBackend";
pub const VR_OVERLAY_START_MODE_CONFIG_KEY: &str = "wristOverlayStartMode";
pub const VR_OVERLAY_BUTTON_CONFIG_KEY: &str = "wristOverlayButton";
pub const VR_OVERLAY_HAND_CONFIG_KEY: &str = "wristOverlayHand";
pub const VR_OVERLAY_SIZE_CONFIG_KEY: &str = "wristOverlaySize";
pub const VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY: &str = "wristOverlayHidePrivateWorlds";
pub const VR_OVERLAY_DARK_BACKGROUND_CONFIG_KEY: &str = "wristOverlayDarkBackground";
pub const VR_OVERLAY_SHOW_DEVICES_CONFIG_KEY: &str = "wristOverlayShowDevices";
pub const VR_OVERLAY_SHOW_BATTERY_PERCENT_CONFIG_KEY: &str = "wristOverlayShowBatteryPercent";
#[cfg(test)]
pub const VR_OVERLAY_PANEL_ENABLED_CONFIG_KEY: &str = "vrOverlayPanelEnabled";
pub const VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY: &str = "vrOverlayPanelSelectedCategory";
#[cfg(test)]
pub const VR_OVERLAY_PANEL_ALL_FRIENDS_INCLUDES_FAVORITES_CONFIG_KEY: &str =
    "vrOverlayPanelAllFriendsIncludesFavorites";
pub const VR_OVERLAY_FRIENDS_PANEL_GROUP_CONFIG_KEY: &str = "vrOverlayFriendsPanelGroup";
pub const HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY: &str = "hmdNotificationsEnabled";
pub const HMD_NOTIFICATION_START_MODE_CONFIG_KEY: &str = "hmdNotificationStartMode";
pub const HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY: &str = "hmdNotificationTimeout";
pub const HMD_NOTIFICATION_OPACITY_CONFIG_KEY: &str = "hmdNotificationOpacity";
pub const HMD_NOTIFICATION_POSITION_CONFIG_KEY: &str = "hmdNotificationPosition";
const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";
const DATE_TIME_HOUR12_CONFIG_KEY: &str = "dtHour12";
const SHOW_INSTANCE_ID_IN_LOCATION_CONFIG_KEY: &str = "VRCX_showInstanceIdInLocation";
pub(in crate::vr_overlay) const FRIENDS_PANEL_RUNTIME_ENABLED: bool = false;

pub(super) fn load_runtime_config(config: &ConfigRepository) -> VrOverlayRuntimeConfig {
    let start_mode = config
        .get_string(VR_OVERLAY_START_MODE_CONFIG_KEY, "vrchatVrMode")
        .map(|value| WristOverlayStartMode::from_config(&value))
        .unwrap_or_default();
    let backend = config
        .get_string(VR_OVERLAY_BACKEND_CONFIG_KEY, "auto")
        .map(|value| OverlayBackendPreference::from_config(&value))
        .unwrap_or_default();
    let button = config
        .get_string(VR_OVERLAY_BUTTON_CONFIG_KEY, "grip")
        .map(|value| match value.trim() {
            "menu" => OverlayActivationButton::Menu,
            _ => OverlayActivationButton::Grip,
        })
        .unwrap_or_default();
    let hand = config
        .get_string(VR_OVERLAY_HAND_CONFIG_KEY, "left")
        .map(|value| WristOverlayHand::from_config(&value))
        .unwrap_or_default();
    let size = config
        .get_string(
            VR_OVERLAY_SIZE_CONFIG_KEY,
            WristOverlaySizePreset::Normal.as_config(),
        )
        .map(|value| WristOverlaySizePreset::from_config(&value))
        .unwrap_or_default();
    let hide_private_worlds = config
        .get_bool(VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY, false)
        .unwrap_or(false);
    let dark_background = config
        .get_bool(VR_OVERLAY_DARK_BACKGROUND_CONFIG_KEY, true)
        .unwrap_or(true);
    let show_devices = config
        .get_bool(VR_OVERLAY_SHOW_DEVICES_CONFIG_KEY, true)
        .unwrap_or(true);
    let show_battery_percent = config
        .get_bool(VR_OVERLAY_SHOW_BATTERY_PERCENT_CONFIG_KEY, false)
        .unwrap_or(false);
    let hmd_enabled = config
        .get_bool(HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY, false)
        .unwrap_or(false);
    let hmd_start_mode = config
        .get_string(HMD_NOTIFICATION_START_MODE_CONFIG_KEY, "vrchatVrMode")
        .map(|value| WristOverlayStartMode::from_config(&value))
        .unwrap_or_default();
    let hmd_timeout_ms = config
        .get_raw(HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(5_000)
        .clamp(1_000, 30_000);
    let hmd_opacity_percent = config
        .get_raw(HMD_NOTIFICATION_OPACITY_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u8>().ok())
        .unwrap_or(100)
        .min(100);
    let hmd_position = config
        .get_string(HMD_NOTIFICATION_POSITION_CONFIG_KEY, "bottom")
        .map(|value| HmdNotificationPosition::from_config(&value))
        .unwrap_or_default();
    let panel_enabled = FRIENDS_PANEL_RUNTIME_ENABLED;
    let panel_all_friends_includes_favorites = true;
    let locale = config
        .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
        .map(|value| OverlayLocale::from_config(&value))
        .unwrap_or_default();
    let dt_hour12 = config
        .get_bool(DATE_TIME_HOUR12_CONFIG_KEY, false)
        .unwrap_or(false);
    let show_instance_id_in_location = config
        .get_bool(SHOW_INSTANCE_ID_IN_LOCATION_CONFIG_KEY, false)
        .unwrap_or(false);

    VrOverlayRuntimeConfig {
        start_mode,
        backend,
        button,
        hand,
        panel_enabled,
        panel_all_friends_includes_favorites,
        hmd: HmdNotificationConfig {
            enabled: hmd_enabled,
            start_mode: hmd_start_mode,
            timeout_ms: hmd_timeout_ms,
            opacity_percent: hmd_opacity_percent,
            position: hmd_position,
        },
        render: WristOverlayRenderOptions {
            size,
            hide_private_worlds,
            dark_background,
            show_devices,
            show_battery_percent,
        },
        locale,
        dt_hour12,
        show_instance_id_in_location,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vr_overlay::runtime::tests::{record_process_status, test_context};
    use crate::vr_overlay::runtime::VrOverlayRuntime;
    use std::sync::Arc;

    #[test]
    fn persisted_panel_enabled_setting_is_ignored_when_panel_is_hidden() {
        let (_dir, _db, context) = test_context("vr-panel-hidden-config");
        context
            .config()
            .set_bool(VR_OVERLAY_PANEL_ENABLED_CONFIG_KEY, true)
            .unwrap();
        let runtime = VrOverlayRuntime::new(Arc::clone(&context));

        assert!(!runtime.current_runtime_config().panel_enabled);

        record_process_status(&runtime, false, true, false);

        assert!(!runtime.is_running());
        assert!(
            !runtime
                .active_surfaces(runtime.current_runtime_config())
                .panel_listener
        );
    }

    #[test]
    fn runtime_config_ignores_hidden_interactive_panel_all_friends_setting() {
        let (_dir, _db, context) = test_context("vr-panel-all-friends-config");
        context
            .config()
            .set_bool(
                VR_OVERLAY_PANEL_ALL_FRIENDS_INCLUDES_FAVORITES_CONFIG_KEY,
                false,
            )
            .unwrap();

        let config = load_runtime_config(context.config());

        assert!(config.panel_all_friends_includes_favorites);
    }
}
