use crate::model::{DeviceChip, FeedLine, OverlayFooter, OverlayNowPlaying, OverlaySize};

#[derive(Clone, Debug, PartialEq)]
pub struct WristSurfaceModel {
    pub size: OverlaySize,
    pub dark_background: bool,
    pub show_battery_percent: bool,
    pub devices: Vec<DeviceChip>,
    pub feed_rows: Vec<FeedLine>,
    pub now_playing: Option<OverlayNowPlaying>,
    pub footer: OverlayFooter,
}
