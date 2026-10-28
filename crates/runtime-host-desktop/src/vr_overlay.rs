use std::sync::Arc;

use vrcx_0_application_core::GameProcessEvent;
use vrcx_0_composition::Result;

use crate::DesktopRuntimeServices;
#[cfg(any(windows, target_os = "linux"))]
use crate::GameIsolationRuntime;

#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_application_core::GameProcessEventSink;
#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_overlay_runtime::{
    VrOverlayActivitySink, VrOverlayRuntime, VrOverlayRuntimeServices,
    VR_OVERLAY_ENABLED_CONFIG_KEY,
};
#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_persistence::config::ConfigRepository;

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

#[cfg(any(windows, target_os = "linux"))]
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

pub struct DesktopVrOverlayRuntime {
    #[cfg(any(windows, target_os = "linux"))]
    config: ConfigRepository,
    #[cfg(any(windows, target_os = "linux"))]
    runtime: Arc<VrOverlayRuntime>,
    #[cfg(any(windows, target_os = "linux"))]
    isolation: GameIsolationRuntime,
}

impl DesktopVrOverlayRuntime {
    pub fn new(services: Arc<DesktopRuntimeServices>) -> Result<Self> {
        #[cfg(any(windows, target_os = "linux"))]
        {
            let config = services.config().clone();
            let runtime = Arc::new(VrOverlayRuntime::new(Arc::clone(&services)));
            let isolation = services.game_isolation();
            let enabled = config.get_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, false)?;
            runtime.set_enabled(enabled && !isolation.is_enabled());
            runtime.start_refresh_loop(services.tasks().clone());
            services
                .set_overlay_activity_extra_sink(Arc::new(VrOverlayActivitySink::new(&runtime)));
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

        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = services;
            Ok(Self {})
        }
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<VrOverlayRuntimeSnapshot> {
        #[cfg(any(windows, target_os = "linux"))]
        {
            self.config
                .set_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, enabled)?;
            self.runtime
                .set_enabled(enabled && !self.isolation.is_enabled());
            self.snapshot()
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = enabled;
            Err(unsupported_error())
        }
    }

    pub fn set_test_mode(&self, test_mode: bool) -> Result<VrOverlayRuntimeSnapshot> {
        #[cfg(any(windows, target_os = "linux"))]
        {
            self.runtime.set_test_mode(test_mode);
            self.snapshot()
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = test_mode;
            Err(unsupported_error())
        }
    }

    #[cfg(any(windows, target_os = "linux"))]
    fn snapshot(&self) -> Result<VrOverlayRuntimeSnapshot> {
        let mut snapshot: VrOverlayRuntimeSnapshot = self.runtime.snapshot().into();
        snapshot.enabled = self.config.get_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, false)?;
        Ok(snapshot)
    }

    pub fn mark_config_dirty(&self) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.mark_config_dirty();
    }

    pub fn reconcile_current(&self) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.reconcile_current();
    }

    pub fn clear_hmd_notifications(&self) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.clear_hmd_notifications();
    }

    pub fn stop_detached(&self) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.stop_detached();
    }

    pub fn set_hmd_friend_membership_provider<F>(&self, provider: F)
    where
        F: Fn(&str) -> bool + Send + Sync + 'static,
    {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.set_hmd_friend_membership_provider(provider);

        #[cfg(not(any(windows, target_os = "linux")))]
        let _ = provider;
    }

    pub fn on_game_process_event(
        &self,
        event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.on_game_process_event(event)?;

        #[cfg(not(any(windows, target_os = "linux")))]
        let _ = event;

        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
fn unsupported_error() -> vrcx_0_composition::Error {
    vrcx_0_composition::Error::Custom(unsupported_message(
        vrcx_0_platform::host_capabilities::current_platform(),
    ))
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
        let runtime = super::DesktopVrOverlayRuntime {};

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
