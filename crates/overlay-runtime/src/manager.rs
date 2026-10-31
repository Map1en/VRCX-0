use std::time::{Duration, Instant};

use vrcx_0_host_desktop::vr_overlay::{OverlaySurfaceConfig, VrDeviceSnapshot};
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

use super::{
    eligibility::VrOverlayEligibility,
    service::{
        OverlayBackendPreference, OverlayServiceStartError, OverlayServiceStartErrorReason,
        VrOverlayServiceControl,
    },
};

const OVERLAY_START_RETRY_INITIAL_BACKOFF: Duration = Duration::from_secs(5);
const OVERLAY_START_RETRY_MAX_BACKOFF: Duration = Duration::from_secs(60);
const OVERLAY_RUNTIME_UNAVAILABLE_RETRY_INTERVAL: Duration = Duration::from_secs(1);

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
                    Err(error) if error.is_permanent() => {
                        self.reset_retry_state();
                        self.unsupported_eligibility = Some(eligibility);
                        tracing::warn!(
                            error = %error.message,
                            "VR overlay backend is unsupported by the current VR runtime; \
                             retrying once VR conditions change"
                        );
                    }
                    Err(error) => {
                        let retry_delay =
                            next_start_retry_delay(&error, &mut self.start_retry_backoff);
                        self.next_start_attempt_at = Some(now + retry_delay);
                        log_overlay_start_error(&error);
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

    pub fn stop_detached(&mut self) {
        self.reset_retry_state();
        self.unsupported_eligibility = None;
        self.service.stop_detached();
    }

    fn reset_retry_state(&mut self) {
        self.next_start_attempt_at = None;
        self.start_retry_backoff = OVERLAY_START_RETRY_INITIAL_BACKOFF;
    }

    pub fn is_running(&self) -> bool {
        self.service.is_running()
    }

    pub fn update_surface_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        self.service.update_surface_frame(surface_id, frame)
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

    pub fn is_surface_visible(&self, surface_id: &OverlaySurfaceId) -> bool {
        self.service.is_surface_visible(surface_id)
    }

    pub fn hmd_user_present(&self) -> Option<bool> {
        self.service.hmd_user_present()
    }

    pub fn into_inner(self) -> S {
        self.service
    }
}

fn next_start_retry_delay(
    error: &OverlayServiceStartError,
    transient_backoff: &mut Duration,
) -> Duration {
    if error.reason == OverlayServiceStartErrorReason::RuntimeUnavailable {
        return OVERLAY_RUNTIME_UNAVAILABLE_RETRY_INTERVAL;
    }
    let retry_delay = *transient_backoff;
    *transient_backoff = (*transient_backoff * 2).min(OVERLAY_START_RETRY_MAX_BACKOFF);
    retry_delay
}

fn log_overlay_start_error(error: &OverlayServiceStartError) {
    match error.reason {
        OverlayServiceStartErrorReason::RuntimeCooldown => tracing::debug!(
            error = %error.message,
            "VR overlay start deferred by runtime quit cooldown"
        ),
        OverlayServiceStartErrorReason::RuntimeUnavailable => tracing::debug!(
            error = %error.message,
            "VR overlay service is waiting for the VR runtime"
        ),
        OverlayServiceStartErrorReason::Other | OverlayServiceStartErrorReason::Unsupported => {
            tracing::warn!(error = %error.message, "failed to start VR overlay service");
        }
    }
}

#[cfg(test)]
mod tests {
    use vrcx_0_host_desktop::vr_overlay::{OverlaySurfaceConfig, VrDeviceSnapshot};
    use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

    use super::{
        next_start_retry_delay, VrOverlayManager, OVERLAY_RUNTIME_UNAVAILABLE_RETRY_INTERVAL,
        OVERLAY_START_RETRY_INITIAL_BACKOFF,
    };
    use crate::{
        service::{OverlayBackendPreference, OverlayServiceStartError, VrOverlayServiceControl},
        VrOverlayEligibility,
    };

    #[test]
    fn runtime_unavailable_retry_stays_short_without_growing_transient_backoff() {
        let mut transient_backoff = OVERLAY_START_RETRY_INITIAL_BACKOFF;

        let delay = next_start_retry_delay(
            &OverlayServiceStartError::runtime_unavailable("runtime is starting"),
            &mut transient_backoff,
        );

        assert_eq!(delay, OVERLAY_RUNTIME_UNAVAILABLE_RETRY_INTERVAL);
        assert_eq!(transient_backoff, OVERLAY_START_RETRY_INITIAL_BACKOFF);

        let delay = next_start_retry_delay(
            &OverlayServiceStartError::transient("backend failed"),
            &mut transient_backoff,
        );

        assert_eq!(delay, OVERLAY_START_RETRY_INITIAL_BACKOFF);
        assert_eq!(transient_backoff, OVERLAY_START_RETRY_INITIAL_BACKOFF * 2);
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
