mod friends;
mod hmd;
mod platform;
mod surface;
mod wrist;

slint::include_modules!();

pub use friends::{SlintPanelEvent, SlintPanelFrame, SlintPanelHost, SlintPanelRenderStats};
pub use hmd::SlintHmdHost;
pub use platform::SlintPanelPointerEvent;
pub use surface::{SlintHmdRenderer, SlintSurfaceHost, SlintSurfaceRenderer, SlintWristRenderer};
pub use wrist::SlintWristHost;

use crate::OverlaySize;

const DEFAULT_WIDTH: u32 = 1080;
const DEFAULT_HEIGHT: u32 = 720;

pub fn default_slint_panel_size() -> OverlaySize {
    OverlaySize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT)
}

#[cfg(test)]
mod tests;
