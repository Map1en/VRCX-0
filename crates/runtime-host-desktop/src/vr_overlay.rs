use std::sync::Arc;

use vrcx_0_application_core::GameProcessEvent;
use vrcx_0_application_game::{GameLogEvent, GameLogEventSink};
use vrcx_0_application_realtime::RealtimeFriendSnapshot;
use vrcx_0_runtime_host::Result;

use crate::DesktopRuntimeServices;

#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_application_core::GameProcessEventSink;
#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_overlay_runtime::{
    VrOverlayActivitySink, VrOverlayRuntime, VR_OVERLAY_ENABLED_CONFIG_KEY,
};
#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_persistence::config::ConfigRepository;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrOverlayRuntimeSnapshot {
    pub enabled: bool,
    pub backend_available: bool,
    pub running: bool,
    pub vr_mode: bool,
    pub steamvr_running: bool,
    pub active_backend: Option<String>,
}

#[cfg(any(windows, target_os = "linux"))]
impl From<vrcx_0_overlay_runtime::VrOverlayRuntimeSnapshot> for VrOverlayRuntimeSnapshot {
    fn from(snapshot: vrcx_0_overlay_runtime::VrOverlayRuntimeSnapshot) -> Self {
        let vrcx_0_overlay_runtime::VrOverlayRuntimeSnapshot {
            enabled,
            backend_available,
            running,
            vr_mode,
            steamvr_running,
            active_backend,
        } = snapshot;
        Self {
            enabled,
            backend_available,
            running,
            vr_mode,
            steamvr_running,
            active_backend,
        }
    }
}

pub struct DesktopVrOverlayRuntime {
    #[cfg(any(windows, target_os = "linux"))]
    config: ConfigRepository,
    #[cfg(any(windows, target_os = "linux"))]
    runtime: Arc<VrOverlayRuntime>,
}

impl DesktopVrOverlayRuntime {
    pub fn new(services: Arc<DesktopRuntimeServices>) -> Result<Self> {
        #[cfg(any(windows, target_os = "linux"))]
        {
            let config = services.data().config().clone();
            let runtime = Arc::new(VrOverlayRuntime::new(Arc::clone(&services)));
            let enabled = config.get_bool(VR_OVERLAY_ENABLED_CONFIG_KEY, false)?;
            runtime.set_enabled(enabled);
            runtime.start_refresh_loop(services.data().tasks.clone());
            services.set_overlay_activity_extra_sink(Arc::new(VrOverlayActivitySink::new(
                Arc::clone(&runtime),
            )));
            Ok(Self { config, runtime })
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
            self.runtime.set_enabled(enabled);
            Ok(self.runtime.snapshot().into())
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = enabled;
            Err(unsupported_error())
        }
    }

    pub fn reload_config(&self) -> Result<VrOverlayRuntimeSnapshot> {
        #[cfg(any(windows, target_os = "linux"))]
        {
            self.runtime.reconcile_current();
            Ok(self.runtime.snapshot().into())
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        Err(unsupported_error())
    }

    pub fn snapshot(&self) -> Result<VrOverlayRuntimeSnapshot> {
        #[cfg(any(windows, target_os = "linux"))]
        {
            Ok(self.runtime.snapshot().into())
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        Err(unsupported_error())
    }

    pub fn is_running(&self) -> bool {
        #[cfg(any(windows, target_os = "linux"))]
        {
            self.runtime.is_running()
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        false
    }

    pub fn reconcile_current(&self) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.reconcile_current();
    }

    pub fn stop_detached(&self) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.stop_detached();
    }

    pub fn clear_friends_panel_session_state(&self) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.clear_friends_panel_session_state();
    }

    pub fn invalidate_friends_panel_note_memo_cache(&self) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.invalidate_friends_panel_note_memo_cache();
    }

    pub fn update_friends_panel_favorite_groups_from_baseline(&self, snapshot: &serde_json::Value) {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime
            .update_friends_panel_favorite_groups_from_baseline(snapshot);

        #[cfg(not(any(windows, target_os = "linux")))]
        let _ = snapshot;
    }

    pub fn set_friends_panel_snapshot_provider<F>(&self, provider: F)
    where
        F: Fn() -> Option<RealtimeFriendSnapshot> + Send + Sync + 'static,
    {
        #[cfg(any(windows, target_os = "linux"))]
        self.runtime.set_friends_panel_snapshot_provider(provider);

        #[cfg(not(any(windows, target_os = "linux")))]
        let _ = provider;
    }

    pub fn on_game_process_event(
        &self,
        event: GameProcessEvent,
        current_vr_mode: Option<bool>,
    ) -> vrcx_0_application_core::Result<()> {
        #[cfg(any(windows, target_os = "linux"))]
        {
            self.runtime.on_game_process_event(event)?;
            if event.is_game_running {
                if let Some(vr_mode) = current_vr_mode {
                    self.runtime.set_vr_mode(vr_mode);
                }
            }
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        let _ = (event, current_vr_mode);

        Ok(())
    }
}

impl GameLogEventSink for DesktopVrOverlayRuntime {
    fn ingest_game_log_event(&self, event: &GameLogEvent) -> vrcx_0_application_core::Result<()> {
        #[cfg(any(windows, target_os = "linux"))]
        {
            self.runtime.ingest_game_log_event(event)
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = event;
            Ok(())
        }
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
fn unsupported_error() -> vrcx_0_runtime_host::Error {
    vrcx_0_runtime_host::Error::Custom(unsupported_message(
        vrcx_0_host::host_capabilities::current_platform(),
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
            runtime.snapshot().unwrap_err().to_string(),
            "VR overlay is not supported on macOS"
        );
        assert_eq!(
            runtime.reload_config().unwrap_err().to_string(),
            "VR overlay is not supported on macOS"
        );
        assert_eq!(
            runtime.set_enabled(true).unwrap_err().to_string(),
            "VR overlay is not supported on macOS"
        );
    }
}
