use std::sync::Arc;

use vrcx_0_application_core::GameProcessEvent;
use vrcx_0_composition::Result;

use crate::DesktopRuntimeServices;

#[cfg(any(windows, target_os = "linux"))]
#[path = "vr_overlay/supported.rs"]
mod imp;
#[cfg(not(any(windows, target_os = "linux")))]
#[path = "vr_overlay/unsupported.rs"]
mod imp;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrOverlayRuntimeSnapshot {
    pub enabled: bool,
    pub backend_available: bool,
    pub running: bool,
    pub steamvr_running: bool,
    pub active_backend: Option<String>,
    pub test_mode: bool,
}

pub struct DesktopVrOverlayRuntime {
    imp: imp::Overlay,
}

impl DesktopVrOverlayRuntime {
    pub fn new(services: Arc<DesktopRuntimeServices>) -> Result<Self> {
        Ok(Self {
            imp: imp::Overlay::new(services)?,
        })
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<VrOverlayRuntimeSnapshot> {
        self.imp.set_enabled(enabled)
    }

    pub fn set_test_mode(&self, test_mode: bool) -> Result<VrOverlayRuntimeSnapshot> {
        self.imp.set_test_mode(test_mode)
    }

    pub fn mark_config_dirty(&self) {
        self.imp.mark_config_dirty();
    }

    pub fn reconcile_current(&self) {
        self.imp.reconcile_current();
    }

    pub fn clear_hmd_notifications(&self) {
        self.imp.clear_hmd_notifications();
    }

    pub fn stop_detached(&self) {
        self.imp.stop_detached();
    }

    pub fn set_hmd_friend_membership_provider<F>(&self, provider: F)
    where
        F: Fn(&str) -> bool + Send + Sync + 'static,
    {
        self.imp.set_hmd_friend_membership_provider(provider);
    }

    pub fn on_game_process_event(
        &self,
        event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        self.imp.on_game_process_event(event)
    }
}

#[cfg(any(test, not(any(windows, target_os = "linux"))))]
fn unsupported_message(platform: &str) -> String {
    let platform = match platform {
        "macos" => "macOS",
        other => other,
    };
    format!("VR overlay is not supported on {platform}")
}

#[cfg(test)]
mod tests {
    use super::unsupported_message;

    #[test]
    fn unsupported_message_uses_macos_product_name() {
        assert_eq!(
            unsupported_message("macos"),
            "VR overlay is not supported on macOS"
        );
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    #[test]
    fn unsupported_facade_rejects_all_commands() {
        let runtime = super::DesktopVrOverlayRuntime {
            imp: super::imp::Overlay,
        };

        assert_eq!(
            runtime.set_enabled(true).unwrap_err().to_string(),
            "VR overlay is not supported on macOS"
        );
        assert_eq!(
            runtime.set_test_mode(true).unwrap_err().to_string(),
            "VR overlay is not supported on macOS"
        );
    }
}
