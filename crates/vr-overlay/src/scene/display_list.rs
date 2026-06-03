use crate::model::{OverlaySize, OverlaySurfaceId};

use super::{DrawCommand, HitRegion};

#[derive(Clone, Debug, PartialEq)]
pub struct OverlayScene {
    pub surface_id: OverlaySurfaceId,
    pub size: OverlaySize,
    pub commands: Vec<DrawCommand>,
    pub hit_regions: Vec<HitRegion>,
}

impl OverlayScene {
    pub fn new(surface_id: OverlaySurfaceId, size: OverlaySize) -> Self {
        Self {
            surface_id,
            size,
            commands: Vec::new(),
            hit_regions: Vec::new(),
        }
    }

    pub fn push(&mut self, command: DrawCommand) {
        self.commands.push(command);
    }
}
