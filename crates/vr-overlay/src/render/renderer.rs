use thiserror::Error;

use crate::{scene::OverlayScene, RgbaFrame};

#[derive(Debug, Error)]
pub enum OverlayRenderError {
    #[error("invalid overlay frame size {width}x{height}")]
    InvalidSize { width: u32, height: u32 },
}

pub trait OverlayRenderer {
    fn render(&mut self, scene: &OverlayScene) -> Result<RgbaFrame, OverlayRenderError>;
}
