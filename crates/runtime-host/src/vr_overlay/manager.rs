use std::time::{Duration, Instant};

use vrcx_0_host::vr_overlay::{OverlayInputEvent, OverlaySurfaceConfig, VrDeviceSnapshot};
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

use super::{
    eligibility::VrOverlayEligibility,
    service::{OverlayBackendPreference, VrOverlayServiceControl},
};

const OVERLAY_START_RETRY_INITIAL_BACKOFF: Duration = Duration::from_secs(5);
const OVERLAY_START_RETRY_MAX_BACKOFF: Duration = Duration::from_secs(60);

pub struct VrOverlayManager<S> {
    service: S,
    next_start_attempt_at: Option<Instant>,
    start_retry_backoff: Duration,
    unsupported_eligibility: Option<VrOverlayEligibility>,
}

impl<S> VrOverlayManager<S>
where
    S: VrOverlayServiceControl,
{
    pub fn new(service: S) -> Self {
        Self {
            service,
            next_start_attempt_at: None,
            start_retry_backoff: OVERLAY_START_RETRY_INITIAL_BACKOFF,
            unsupported_eligibility: None,
        }
    }

    pub fn reconcile(&mut self, eligibility: VrOverlayEligibility) {
        if eligibility.can_run() {
            if self
                .unsupported_eligibility
                .is_some_and(|blocked| blocked == eligibility)
            {
                return;
            }
            self.unsupported_eligibility = None;
            if !self.service.is_running() {
                let now = Instant::now();
                if self
                    .next_start_attempt_at
                    .is_some_and(|next_attempt| now < next_attempt)
                {
                    return;
                }
                match self.service.start() {
                    Ok(()) => {
                        self.reset_retry_state();
                    }
                    Err(error) if error.permanent => {
                        self.reset_retry_state();
                        self.unsupported_eligibility = Some(eligibility);
                        tracing::warn!(
                            error = %error.message,
                            "VR overlay backend is unsupported by the current VR runtime; \
                             retrying once VR conditions change"
                        );
                    }
                    Err(error) => {
                        self.next_start_attempt_at = Some(now + self.start_retry_backoff);
                        self.start_retry_backoff =
                            (self.start_retry_backoff * 2).min(OVERLAY_START_RETRY_MAX_BACKOFF);
                        log_overlay_start_error(&error.message);
                    }
                }
            } else {
                self.reset_retry_state();
            }
        } else {
            self.reset_retry_state();
            self.unsupported_eligibility = None;
            if self.service.should_stop_when_ineligible() {
                self.service.stop();
            }
        }
    }

    fn reset_retry_state(&mut self) {
        self.next_start_attempt_at = None;
        self.start_retry_backoff = OVERLAY_START_RETRY_INITIAL_BACKOFF;
    }

    pub fn is_running(&self) -> bool {
        self.service.is_running()
    }

    pub fn update_frame(&mut self, frame: RgbaFrame) -> Result<(), String> {
        self.service.update_frame(frame)
    }

    pub fn update_surface_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        self.service.update_surface_frame(surface_id, frame)
    }

    pub fn show(&mut self) -> Result<(), String> {
        self.service.show()
    }

    pub fn show_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.service.show_surface(surface_id)
    }

    pub fn hide_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.service.hide_surface(surface_id)
    }

    pub fn set_surface_alpha(
        &mut self,
        surface_id: &OverlaySurfaceId,
        alpha: f32,
    ) -> Result<(), String> {
        self.service.set_surface_alpha(surface_id, alpha)
    }

    pub fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        self.service.snapshot_devices()
    }

    pub fn drain_input_events(&mut self) -> Vec<OverlayInputEvent> {
        self.service.drain_input_events()
    }

    pub fn set_interaction_active(&mut self, active: bool) -> Result<(), String> {
        self.service.set_interaction_active(active)
    }

    pub fn set_surface_configs(
        &mut self,
        configs: Vec<OverlaySurfaceConfig>,
    ) -> Result<(), String> {
        self.service.set_surface_configs(configs)
    }

    pub fn set_backend_preference(&mut self, preference: OverlayBackendPreference) {
        self.unsupported_eligibility = None;
        self.reset_retry_state();
        self.service.set_backend_preference(preference);
    }

    pub fn active_backend(&self) -> Option<&'static str> {
        self.service.active_backend()
    }

    pub fn into_inner(self) -> S {
        self.service
    }
}

fn log_overlay_start_error(error: &str) {
    if !is_expected_overlay_start_wait(error) {
        tracing::warn!(error = %error, "failed to start VR overlay service");
        return;
    }
    if error.contains("cooling down") {
        tracing::debug!(
            error = %error,
            "VR overlay start deferred by runtime quit cooldown"
        );
    } else {
        tracing::debug!(
            error = %error,
            "VR overlay service is waiting for the OpenVR server"
        );
    }
}

fn is_expected_overlay_start_wait(error: &str) -> bool {
    error.contains("VRInitError_Init_NoServerForBackgroundApp") || error.contains("cooling down")
}

#[cfg(test)]
mod tests {
    use vrcx_0_host::vr_overlay::{OverlaySurfaceConfig, VrDeviceSnapshot};
    use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

    use super::{is_expected_overlay_start_wait, VrOverlayManager};
    use crate::vr_overlay::{
        service::{OverlayBackendPreference, OverlayServiceStartError, VrOverlayServiceControl},
        VrOverlayEligibility,
    };

    #[test]
    fn expected_overlay_start_wait_matches_openvr_server_and_cooldown_errors() {
        assert!(is_expected_overlay_start_wait(
            "OpenVR init failed: VRInitError_Init_NoServerForBackgroundApp"
        ));
        assert!(is_expected_overlay_start_wait(
            "VR runtime quit 120ms ago; cooling down"
        ));
        assert!(!is_expected_overlay_start_wait(
            "OpenVR init failed: VRInitError_Init_InterfaceNotFound"
        ));
    }

    #[test]
    fn ineligible_reconcile_stops_service_that_needs_stop_without_running() {
        let service = RecordingService {
            needs_stop_when_ineligible: true,
            ..RecordingService::default()
        };
        let mut manager = VrOverlayManager::new(service);

        manager.reconcile(VrOverlayEligibility::default());

        let service = manager.into_inner();
        assert_eq!(service.starts, 0);
        assert_eq!(service.stops, 1);
    }

    #[derive(Default)]
    struct RecordingService {
        running: bool,
        needs_stop_when_ineligible: bool,
        starts: usize,
        stops: usize,
    }

    impl VrOverlayServiceControl for RecordingService {
        fn start(&mut self) -> Result<(), OverlayServiceStartError> {
            self.starts += 1;
            self.running = true;
            Ok(())
        }

        fn update_frame(&mut self, _frame: RgbaFrame) -> Result<(), String> {
            Ok(())
        }

        fn show(&mut self) -> Result<(), String> {
            Ok(())
        }

        fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
            Ok(Vec::new())
        }

        fn set_surface_configs(
            &mut self,
            _configs: Vec<OverlaySurfaceConfig>,
        ) -> Result<(), String> {
            Ok(())
        }

        fn set_backend_preference(&mut self, _preference: OverlayBackendPreference) {}

        fn active_backend(&self) -> Option<&'static str> {
            self.running.then_some("test")
        }

        fn should_stop_when_ineligible(&self) -> bool {
            self.needs_stop_when_ineligible
        }

        fn stop(&mut self) {
            self.stops += 1;
            self.running = false;
            self.needs_stop_when_ineligible = false;
        }

        fn is_running(&self) -> bool {
            self.running
        }

        fn update_surface_frame(
            &mut self,
            _surface_id: &OverlaySurfaceId,
            _frame: RgbaFrame,
        ) -> Result<(), String> {
            Ok(())
        }

        fn show_surface(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
            Ok(())
        }

        fn hide_surface(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
            Ok(())
        }

        fn set_surface_alpha(
            &mut self,
            _surface_id: &OverlaySurfaceId,
            _alpha: f32,
        ) -> Result<(), String> {
            Ok(())
        }
    }
}
