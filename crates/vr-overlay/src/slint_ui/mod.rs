#[cfg(feature = "friends-panel")]
mod friends;
mod hmd;
mod platform;
mod surface;
mod wrist;

slint::include_modules!();

#[cfg(feature = "friends-panel")]
pub use friends::{SlintPanelEvent, SlintPanelFrame, SlintPanelHost, SlintPanelRenderStats};
pub use hmd::SlintHmdHost;
#[cfg(feature = "friends-panel")]
pub use platform::SlintPanelPointerEvent;
pub use surface::{SlintHmdRenderer, SlintSurfaceHost, SlintSurfaceRenderer, SlintWristRenderer};
pub use wrist::SlintWristHost;

#[cfg(feature = "friends-panel")]
use crate::OverlaySize;

#[cfg(feature = "friends-panel")]
const DEFAULT_WIDTH: u32 = 1080;
#[cfg(feature = "friends-panel")]
const DEFAULT_HEIGHT: u32 = 720;

#[cfg(feature = "friends-panel")]
pub fn default_slint_panel_size() -> OverlaySize {
    OverlaySize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT)
}

#[cfg(test)]
mod tests;
