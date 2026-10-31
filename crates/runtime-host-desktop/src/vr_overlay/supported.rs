use std::sync::Arc;

use vrcx_0_application_core::{GameProcessEvent, GameProcessEventSink};
use vrcx_0_composition::Result;
use vrcx_0_overlay_runtime::{
    VrOverlayActivitySink, VrOverlayRuntime, VrOverlayRuntimeServices,
    VR_OVERLAY_ENABLED_CONFIG_KEY,
};
use vrcx_0_persistence::config::ConfigRepository;

use super::VrOverlayRuntimeSnapshot;
use crate::{DesktopRuntimeServices, GameIsolationRuntime};

impl From<vrcx_0_overlay_runtime::VrOverlayRuntimeSnapshot> for VrOverlayRuntimeSnapshot {
    fn from(snapshot: vrcx_0_overlay_runtime::VrOverlayRuntimeSnapshot) -> Self {
        let vrcx_0_overlay_runtime::VrOverlayRuntimeSnapshot {
            enabled,
            backend_available,
            running,
            steamvr_running,
            active_backend,
            test_mode,
        } = snapshot;
        Self {
            enabled,
            backend_available,
            running,
            steamvr_running,
            active_backend,
            test_mode,
        }
    }
}

pub(super) struct Overlay {
    config: ConfigRepository,
    runtime: Arc<VrOverlayRuntime>,
    isolation: GameIsolationRuntime,
}

impl Overlay {
    pub(super) fn new(services: Arc<DesktopRuntimeServices>) -> Result<Self> {
        let config = services.config().clone();
        let runtime = Arc::new(VrOverlayRuntime::new(Arc::clone(&services)));
        let isolation = services.game_isolation();
        let enabled = config.get_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, false)?;
        runtime.set_enabled(enabled && !isolation.is_enabled());
        runtime.start_refresh_loop(services.tasks().clone());
        services.set_overlay_activity_extra_sink(Arc::new(VrOverlayActivitySink::new(&runtime)));
        let observed_runtime = Arc::downgrade(&runtime);
        let observed_config = config.clone();
        isolation.add_observer(Arc::new(move |isolated| {
            let Some(runtime) = observed_runtime.upgrade() else {
                return;
            };
            let enabled = observed_config
                .get_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, false)
                .unwrap_or(false);
            runtime.set_enabled(enabled && !isolated);
        }));
        Ok(Self {
            config,
            runtime,
            isolation,
        })
    }

    pub(super) fn set_enabled(&self, enabled: bool) -> Result<VrOverlayRuntimeSnapshot> {
        self.config
            .set_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, enabled)?;
        self.runtime
            .set_enabled(enabled && !self.isolation.is_enabled());
        self.snapshot()
    }

    pub(super) fn set_test_mode(&self, test_mode: bool) -> Result<VrOverlayRuntimeSnapshot> {
        self.runtime.set_test_mode(test_mode);
        self.snapshot()
    }

    fn snapshot(&self) -> Result<VrOverlayRuntimeSnapshot> {
        let mut snapshot: VrOverlayRuntimeSnapshot = self.runtime.snapshot().into();
        snapshot.enabled = self.config.get_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, false)?;
        Ok(snapshot)
    }

    pub(super) fn mark_config_dirty(&self) {
        self.runtime.mark_config_dirty();
    }

    pub(super) fn reconcile_current(&self) {
        self.runtime.reconcile_current();
    }

    pub(super) fn clear_hmd_notifications(&self) {
        self.runtime.clear_hmd_notifications();
    }

    pub(super) fn stop_detached(&self) {
        self.runtime.stop_detached();
    }

    pub(super) fn set_hmd_friend_membership_provider<F>(&self, provider: F)
    where
        F: Fn(&str) -> bool + Send + Sync + 'static,
    {
        self.runtime.set_hmd_friend_membership_provider(provider);
    }

    pub(super) fn on_game_process_event(
        &self,
        event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        self.runtime.on_game_process_event(event)
    }
}
