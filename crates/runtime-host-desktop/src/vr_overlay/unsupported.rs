use std::sync::Arc;

use vrcx_0_application_core::GameProcessEvent;
use vrcx_0_composition::Result;

use super::{unsupported_message, VrOverlayRuntimeSnapshot};
use crate::DesktopRuntimeServices;

pub(super) struct Overlay;

impl Overlay {
    pub(super) fn new(_services: Arc<DesktopRuntimeServices>) -> Result<Self> {
        Ok(Self)
    }

    pub(super) fn set_enabled(&self, _enabled: bool) -> Result<VrOverlayRuntimeSnapshot> {
        Err(unsupported_error())
    }

    pub(super) fn set_test_mode(&self, _test_mode: bool) -> Result<VrOverlayRuntimeSnapshot> {
        Err(unsupported_error())
    }

    pub(super) fn mark_config_dirty(&self) {}

    pub(super) fn reconcile_current(&self) {}

    pub(super) fn clear_hmd_notifications(&self) {}

    pub(super) fn stop_detached(&self) {}

    pub(super) fn set_hmd_friend_membership_provider<F>(&self, _provider: F)
    where
        F: Fn(&str) -> bool + Send + Sync + 'static,
    {
    }

    pub(super) fn on_game_process_event(
        &self,
        _event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        Ok(())
    }
}

fn unsupported_error() -> vrcx_0_composition::Error {
    vrcx_0_application_core::Error::Custom(unsupported_message(
        vrcx_0_platform::host_capabilities::current_platform(),
    ))
    .into()
}
