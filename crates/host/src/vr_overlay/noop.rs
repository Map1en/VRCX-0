use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

use super::{
    actor::OverlayBackend,
    types::{OverlaySurfaceConfig, VrDeviceSnapshot},
};

#[derive(Default)]
pub struct NoopOverlayBackend;

impl OverlayBackend for NoopOverlayBackend {
    fn start(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn register_surface(&mut self, _config: OverlaySurfaceConfig) -> Result<(), String> {
        Ok(())
    }

    fn update_frame(
        &mut self,
        _surface_id: &OverlaySurfaceId,
        _frame: RgbaFrame,
    ) -> Result<(), String> {
        Ok(())
    }

    fn show(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn hide(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn stop(&mut self) {}
}
