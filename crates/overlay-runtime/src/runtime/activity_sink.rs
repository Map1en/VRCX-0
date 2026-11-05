use std::sync::{Arc, Weak};

use vrcx_0_application_activity::{ActivityDelivery, ActivitySink, ActivitySnapshot};

use super::VrOverlayRuntime;

#[derive(Clone)]
pub struct VrOverlayActivitySink {
    runtime: Weak<VrOverlayRuntime>,
}

impl VrOverlayActivitySink {
    pub fn new(runtime: &Arc<VrOverlayRuntime>) -> Self {
        Self {
            runtime: Arc::downgrade(runtime),
        }
    }
}

impl ActivitySink for VrOverlayActivitySink {
    fn emit_overlay_activity_snapshot(&self, snapshot: ActivitySnapshot) {
        if let Some(runtime) = self.runtime.upgrade() {
            runtime.prefetch_wrist_group_names(&snapshot);
            runtime.reconcile_current();
        }
    }

    fn emit_overlay_activity_delivery(&self, delivery: ActivityDelivery) {
        if let Some(runtime) = self.runtime.upgrade() {
            runtime.ingest_hmd_delivery(delivery);
        }
    }
}
