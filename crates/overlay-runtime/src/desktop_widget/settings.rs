use vrcx_0_application_core::ConfigStore;
use vrcx_0_contracts::resolve_config_key;

pub const DESKTOP_WIDGET_ENABLED_CONFIG_KEY: &str = "desktopWidgetEnabled";
pub const DESKTOP_WIDGET_PINNED_CONFIG_KEY: &str = "desktopWidgetPinned";
pub const DESKTOP_WIDGET_CLICK_THROUGH_CONFIG_KEY: &str = "desktopWidgetClickThrough";
pub const DESKTOP_WIDGET_OPACITY_CONFIG_KEY: &str = "desktopWidgetOpacity";
pub const DESKTOP_WIDGET_BOUNDS_CONFIG_KEY: &str = "desktopWidgetBounds";
pub const DESKTOP_WIDGET_NEWEST_ON_TOP_CONFIG_KEY: &str = "desktopWidgetNewestOnTop";
const DESKTOP_WIDGET_CONFIG_KEY_PREFIX: &str = "desktopWidget";

pub fn is_desktop_widget_config_key(key: &str) -> bool {
    resolve_config_key(key).starts_with(&resolve_config_key(DESKTOP_WIDGET_CONFIG_KEY_PREFIX))
        || crate::config::is_localizer_config_key(key)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DesktopWidgetBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopWidgetSettings {
    pub enabled: bool,
    pub pinned: bool,
    pub click_through: bool,
    pub background_opacity: u8,
    pub newest_on_top: bool,
    pub bounds: Option<DesktopWidgetBounds>,
}

const DEFAULT_OPACITY: u8 = 55;
const DEFAULT_WIDTH: i32 = 320;
const DEFAULT_HEIGHT: i32 = 240;
const DEFAULT_MARGIN: i32 = 24;
const MIN_VISIBLE: i32 = 48;

impl DesktopWidgetSettings {
    pub fn load(config: &dyn ConfigStore) -> Self {
        let click_through = config
            .get_bool(DESKTOP_WIDGET_CLICK_THROUGH_CONFIG_KEY, false)
            .unwrap_or(false);
        let pinned = click_through
            || config
                .get_bool(DESKTOP_WIDGET_PINNED_CONFIG_KEY, true)
                .unwrap_or(true);
        Self {
            enabled: config
                .get_bool(DESKTOP_WIDGET_ENABLED_CONFIG_KEY, false)
                .unwrap_or(false),
            pinned,
            click_through,
            background_opacity: config
                .get_raw(DESKTOP_WIDGET_OPACITY_CONFIG_KEY)
                .ok()
                .flatten()
                .and_then(|value| value.trim().parse::<u32>().ok())
                .map_or(DEFAULT_OPACITY, |value| value.min(100) as u8),
            newest_on_top: config
                .get_bool(DESKTOP_WIDGET_NEWEST_ON_TOP_CONFIG_KEY, true)
                .unwrap_or(true),
            bounds: config
                .get_raw(DESKTOP_WIDGET_BOUNDS_CONFIG_KEY)
                .ok()
                .flatten()
                .and_then(|value| serde_json::from_str(&value).ok()),
        }
    }

    pub fn save(&self, config: &dyn ConfigStore) -> vrcx_0_application_core::Result<()> {
        config.set_bool(DESKTOP_WIDGET_ENABLED_CONFIG_KEY, self.enabled)?;
        config.set_bool(DESKTOP_WIDGET_PINNED_CONFIG_KEY, self.pinned)?;
        config.set_bool(DESKTOP_WIDGET_CLICK_THROUGH_CONFIG_KEY, self.click_through)?;
        match self.bounds {
            Some(bounds) => config.set_json(
                DESKTOP_WIDGET_BOUNDS_CONFIG_KEY,
                &serde_json::to_value(bounds)?,
            ),
            None => config.remove(DESKTOP_WIDGET_BOUNDS_CONFIG_KEY),
        }
    }

    pub fn set_pinned(&mut self, pinned: bool) {
        self.pinned = pinned;
        if !pinned {
            self.click_through = false;
        }
    }

    pub fn set_click_through(&mut self, click_through: bool) {
        self.click_through = click_through;
        if click_through {
            self.pinned = true;
        }
    }
}

pub fn place_on_screens(
    saved: Option<DesktopWidgetBounds>,
    screens: &[DesktopWidgetBounds],
    primary: DesktopWidgetBounds,
    scale: f64,
) -> DesktopWidgetBounds {
    if let Some(saved) = saved {
        if screens.iter().any(|screen| visible_overlap(saved, *screen)) {
            return saved;
        }
    }
    let scaled = |value: i32| (f64::from(value) * scale).round() as i32;
    let width = saved.map_or(scaled(DEFAULT_WIDTH), |saved| {
        saved.width.min(primary.width)
    });
    let height = saved.map_or(scaled(DEFAULT_HEIGHT), |saved| {
        saved.height.min(primary.height)
    });
    let margin = scaled(DEFAULT_MARGIN);
    DesktopWidgetBounds {
        x: (primary.x + primary.width - width - margin).max(primary.x),
        y: (primary.y + margin * 3)
            .min(primary.y + primary.height - height)
            .max(primary.y),
        width,
        height,
    }
}

fn visible_overlap(bounds: DesktopWidgetBounds, screen: DesktopWidgetBounds) -> bool {
    let width = (bounds.x + bounds.width).min(screen.x + screen.width) - bounds.x.max(screen.x);
    let height = (bounds.y + bounds.height).min(screen.y + screen.height) - bounds.y.max(screen.y);
    width >= MIN_VISIBLE && height >= MIN_VISIBLE
}

#[cfg(test)]
mod tests;
