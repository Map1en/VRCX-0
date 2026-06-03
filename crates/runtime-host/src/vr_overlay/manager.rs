use std::time::{Duration, Instant};

use vrcx_0_host::vr_overlay::{OverlaySurfaceConfig, VrDeviceSnapshot};
use vrcx_0_vr_overlay::RgbaFrame;

use super::{eligibility::VrOverlayEligibility, service::VrOverlayServiceControl};

const OVERLAY_START_RETRY_BACKOFF: Duration = Duration::from_secs(5);

pub struct VrOverlayManager<S> {
    service: S,
    next_start_attempt_at: Option<Instant>,
}

impl<S> VrOverlayManager<S>
where
    S: VrOverlayServiceControl,
{
    pub fn new(service: S) -> Self {
        Self {
            service,
            next_start_attempt_at: None,
        }
    }

    pub fn reconcile(&mut self, eligibility: VrOverlayEligibility) {
        if eligibility.can_run() {
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
                        self.next_start_attempt_at = None;
                    }
                    Err(error) => {
                        self.next_start_attempt_at = Some(now + OVERLAY_START_RETRY_BACKOFF);
                        log_overlay_start_error(&error);
                    }
                }
            } else {
                self.next_start_attempt_at = None;
            }
        } else {
            self.next_start_attempt_at = None;
            if self.service.is_running() {
                self.service.stop();
            }
        }
    }

    pub fn is_running(&self) -> bool {
        self.service.is_running()
    }

    pub fn update_frame(&mut self, frame: RgbaFrame) -> Result<(), String> {
        self.service.update_frame(frame)
    }

    pub fn show(&mut self) -> Result<(), String> {
        self.service.show()
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

    pub fn into_inner(self) -> S {
        self.service
    }
}

fn log_overlay_start_error(error: &str) {
    if is_openvr_server_unavailable_error(error) {
        tracing::debug!(
            error = %error,
            "VR overlay service is waiting for the OpenVR server"
        );
        return;
    }
    tracing::warn!(error = %error, "failed to start VR overlay service");
}

fn is_openvr_server_unavailable_error(error: &str) -> bool {
    error.contains("VRInitError_Init_NoServerForBackgroundApp")
}
