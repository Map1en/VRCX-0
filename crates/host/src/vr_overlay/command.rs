use thiserror::Error;
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

use super::types::OverlaySurfaceConfig;

#[derive(Debug)]
pub enum OverlayServiceCommand {
    Start,
    RegisterSurface(OverlaySurfaceConfig),
    RegisterOptionalSurface(OverlaySurfaceConfig),
    UnregisterSurface(OverlaySurfaceId),
    UpdateFrame {
        surface_id: OverlaySurfaceId,
        frame: RgbaFrame,
    },
    Show(OverlaySurfaceId),
    Hide(OverlaySurfaceId),
    Stop,
}

#[derive(Debug, Error)]
pub enum OverlayCommandError {
    #[error("overlay actor has stopped")]
    Stopped,
    #[error("invalid RGBA frame length: expected {expected} bytes, got {actual}")]
    InvalidFrameLength { expected: usize, actual: usize },
    #[error("RGBA frame dimensions are too large")]
    InvalidFrameDimensions,
    #[error("overlay backend error: {0}")]
    Backend(String),
}
