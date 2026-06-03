use crate::model::{Color, DeviceChip, FeedLine, OverlayFooter, OverlaySize};

#[derive(Clone, Debug, PartialEq)]
pub struct WristSurfaceModel {
    pub size: OverlaySize,
    pub dark_background: bool,
    pub show_battery_percent: bool,
    pub devices: Vec<DeviceChip>,
    pub feed_rows: Vec<FeedLine>,
    pub footer: OverlayFooter,
    pub accent: Color,
    pub captured_at_ms: i64,
}
