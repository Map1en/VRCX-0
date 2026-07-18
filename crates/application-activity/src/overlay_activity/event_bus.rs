use vrcx_0_application_core::{RuntimeEventBus, RuntimeEventPayload};

use super::OverlayActivitySnapshot;

pub trait RuntimeOverlayActivityEventBusExt {
    fn emit_overlay_activity_snapshot(&self, payload: OverlayActivitySnapshot);
}

impl RuntimeEventPayload for OverlayActivitySnapshot {
    const EVENT_NAME: &'static str = "overlayActivitySnapshot";
}

impl RuntimeOverlayActivityEventBusExt for RuntimeEventBus {
    fn emit_overlay_activity_snapshot(&self, payload: OverlayActivitySnapshot) {
        self.emit(payload);
    }
}
