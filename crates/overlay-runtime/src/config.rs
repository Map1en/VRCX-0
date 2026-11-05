use crate::VrOverlayRuntimeServices;
use vrcx_0_vr_overlay_backend::OverlayActivationButton;

use super::eligibility::WristOverlayStartMode;
use super::localization::{OverlayLocale, OverlayLocalizer};
use super::service::OverlayBackendPreference;
use super::{WristOverlayRenderOptions, WristOverlaySizePreset};
use vrcx_0_application_core::ConfigStore;

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
pub const HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY: &str = "hmdNotificationsEnabled";
pub const HMD_NOTIFICATION_START_MODE_CONFIG_KEY: &str = "hmdNotificationStartMode";
pub const HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY: &str = "hmdNotificationTimeout";
pub const HMD_NOTIFICATION_OPACITY_CONFIG_KEY: &str = "hmdNotificationOpacity";
pub const HMD_NOTIFICATION_POSITION_CONFIG_KEY: &str = "hmdNotificationPosition";
pub const HMD_NOTIFICATION_STYLE_CONFIG_KEY: &str = "hmdNotificationStyle";
pub const HMD_NOTIFICATION_AVATARS_CONFIG_KEY: &str = "hmdNotificationAvatars";
pub const HMD_NOTIFICATION_TRACKER_DISCONNECT_CONFIG_KEY: &str = "hmdNotificationTrackerDisconnect";
const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";
const DATE_TIME_HOUR12_CONFIG_KEY: &str = "dtHour12";
const SHOW_INSTANCE_ID_IN_LOCATION_CONFIG_KEY: &str = "VRCX_showInstanceIdInLocation";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WristOverlayHand {
    #[default]
    Left,
    Right,
    Both,
}

impl WristOverlayHand {
    pub(crate) fn from_config(value: &str) -> Self {
        match value.trim() {
            "right" => Self::Right,
            "both" => Self::Both,
            _ => Self::Left,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HmdNotificationPosition {
    Top,
    Center,
    #[default]
    Bottom,
}

impl HmdNotificationPosition {
    pub(crate) fn from_config(value: &str) -> Self {
        match value.trim() {
            "top" => Self::Top,
            "center" => Self::Center,
            _ => Self::Bottom,
        }
    }

    pub(crate) fn newest_card_angle_degrees(self) -> f32 {
        match self {
            Self::Top => 4.0,
            Self::Center => -6.0,
            Self::Bottom => -18.0,
        }
    }

    pub(crate) fn stacks_upward(self) -> bool {
        self == Self::Top
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HmdNotificationStyle {
    #[default]
    Standard,
    Compact,
}

impl HmdNotificationStyle {
    pub(crate) fn from_config(value: &str) -> Self {
        match value.trim() {
            "compact" => Self::Compact,
            _ => Self::Standard,
        }
    }

    pub(crate) fn single_card_height_px(self) -> f32 {
        match self {
            Self::Standard => 112.0,
            Self::Compact => 60.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HmdNotificationConfig {
    pub(crate) enabled: bool,
    pub(crate) start_mode: WristOverlayStartMode,
    pub(crate) timeout_ms: u64,
    pub(crate) opacity_percent: u8,
    pub(crate) position: HmdNotificationPosition,
    pub(crate) style: HmdNotificationStyle,
    pub(crate) avatars: bool,
    pub(crate) tracker_disconnect: bool,
}

impl Default for HmdNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            start_mode: WristOverlayStartMode::Vrchat,
            timeout_ms: 5_000,
            opacity_percent: 90,
            position: HmdNotificationPosition::Bottom,
            style: HmdNotificationStyle::Standard,
            avatars: true,
            tracker_disconnect: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct VrOverlayRuntimeConfig {
    pub(crate) start_mode: WristOverlayStartMode,
    pub(crate) backend: OverlayBackendPreference,
    pub(crate) button: OverlayActivationButton,
    pub(crate) hand: WristOverlayHand,
    pub(crate) hmd: HmdNotificationConfig,
    pub(crate) render: WristOverlayRenderOptions,
    pub(crate) locale: OverlayLocale,
    pub(crate) dt_hour12: bool,
    pub(crate) show_instance_id_in_location: bool,
}

impl Default for VrOverlayRuntimeConfig {
    fn default() -> Self {
        Self {
            start_mode: WristOverlayStartMode::Vrchat,
            backend: OverlayBackendPreference::Auto,
            button: OverlayActivationButton::Grip,
            hand: WristOverlayHand::Left,
            hmd: HmdNotificationConfig::default(),
            render: WristOverlayRenderOptions::default(),
            locale: OverlayLocale::default(),
            dt_hour12: false,
            show_instance_id_in_location: false,
        }
    }
}

impl VrOverlayRuntimeConfig {
    fn surface_config_key(self) -> WristSurfaceRuntimeConfig {
        WristSurfaceRuntimeConfig {
            button: self.button,
            hand: self.hand,
            size: self.render.size,
            hmd_enabled: self.hmd.enabled,
            hmd_position: self.hmd.position,
        }
    }

    pub(crate) fn should_clear_device_snapshot_for(self, next_config: Self) -> bool {
        self.surface_config_key() != next_config.surface_config_key()
            || self.render.show_devices != next_config.render.show_devices
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WristSurfaceRuntimeConfig {
    button: OverlayActivationButton,
    hand: WristOverlayHand,
    size: WristOverlaySizePreset,
    hmd_enabled: bool,
    hmd_position: HmdNotificationPosition,
}

#[cfg(windows)]
pub(crate) fn load_app_language(config: &dyn ConfigStore) -> String {
    config
        .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
        .unwrap_or_else(|_| "en".to_string())
}

fn load_locale_settings(config: &dyn ConfigStore) -> (OverlayLocale, bool) {
    let locale = config
        .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
        .map(|value| OverlayLocale::from_config(&value))
        .unwrap_or_default();
    let show_instance_id_in_location = config
        .get_bool(SHOW_INSTANCE_ID_IN_LOCATION_CONFIG_KEY, false)
        .unwrap_or(false);
    (locale, show_instance_id_in_location)
}

pub(crate) fn is_localizer_config_key(key: &str) -> bool {
    let key = vrcx_0_contracts::resolve_config_key(key);
    [
        APP_LANGUAGE_CONFIG_KEY,
        SHOW_INSTANCE_ID_IN_LOCATION_CONFIG_KEY,
    ]
    .into_iter()
    .any(|localizer_key| vrcx_0_contracts::resolve_config_key(localizer_key) == key)
}

pub(crate) fn load_localizer(config: &dyn ConfigStore) -> OverlayLocalizer {
    let (locale, show_instance_id) = load_locale_settings(config);
    OverlayLocalizer::with_instance_id(locale, show_instance_id)
}

pub(super) fn load_runtime_config(
    services: &dyn VrOverlayRuntimeServices,
) -> VrOverlayRuntimeConfig {
    let config = services.config().as_ref();
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
        .unwrap_or(90)
        .min(100);
    let hmd_position = config
        .get_string(HMD_NOTIFICATION_POSITION_CONFIG_KEY, "bottom")
        .map(|value| HmdNotificationPosition::from_config(&value))
        .unwrap_or_default();
    let hmd_style = config
        .get_string(HMD_NOTIFICATION_STYLE_CONFIG_KEY, "standard")
        .map(|value| HmdNotificationStyle::from_config(&value))
        .unwrap_or_default();
    let (locale, show_instance_id_in_location) = load_locale_settings(config);
    let dt_hour12 = config
        .get_bool(DATE_TIME_HOUR12_CONFIG_KEY, false)
        .unwrap_or(false);

    VrOverlayRuntimeConfig {
        start_mode,
        backend,
        button,
        hand,
        hmd: HmdNotificationConfig {
            enabled: hmd_enabled,
            start_mode: hmd_start_mode,
            timeout_ms: hmd_timeout_ms,
            opacity_percent: hmd_opacity_percent,
            position: hmd_position,
            style: hmd_style,
            avatars: config
                .get_bool(HMD_NOTIFICATION_AVATARS_CONFIG_KEY, true)
                .unwrap_or(true),
            tracker_disconnect: config
                .get_bool(HMD_NOTIFICATION_TRACKER_DISCONNECT_CONFIG_KEY, true)
                .unwrap_or(true),
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
