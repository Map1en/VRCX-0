use vrcx_0_host_desktop::vr_overlay::{OverlaySurfaceConfig, VrDeviceSnapshot};
use vrcx_0_overlay_runtime::{
    OverlayServiceStartError, VrOverlayEligibility, VrOverlayManager, VrOverlayServiceControl,
    WristOverlayStartMode,
};
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

fn eligible(start_mode: WristOverlayStartMode) -> VrOverlayEligibility {
    VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        game_running: true,
        steamvr_running: true,
        start_mode,
    }
}

#[test]
fn manager_does_not_start_vrchat_mode_until_both_processes_are_running() {
    let service = RecordingOverlayService::default();
    let starts = service.starts.clone();
    let stops = service.stops.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(VrOverlayEligibility {
        enabled: false,
        ..eligible(WristOverlayStartMode::Vrchat)
    });
    manager.reconcile(VrOverlayEligibility {
        steamvr_running: false,
        ..eligible(WristOverlayStartMode::Vrchat)
    });
    manager.reconcile(VrOverlayEligibility {
        game_running: false,
        ..eligible(WristOverlayStartMode::Vrchat)
    });
    manager.reconcile(VrOverlayEligibility {
        backend_available: false,
        ..eligible(WristOverlayStartMode::Vrchat)
    });

    assert_eq!(*starts.borrow(), 0);
    assert_eq!(*stops.borrow(), 0);
    assert!(!manager.is_running());
}

#[test]
fn manager_starts_once_when_eligible_and_stops_when_ineligible() {
    let service = RecordingOverlayService::default();
    let starts = service.starts.clone();
    let stops = service.stops.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(eligible(WristOverlayStartMode::Vrchat));
    manager.reconcile(eligible(WristOverlayStartMode::Vrchat));
    manager.reconcile(VrOverlayEligibility {
        game_running: false,
        ..eligible(WristOverlayStartMode::Vrchat)
    });

    assert_eq!(*starts.borrow(), 1);
    assert_eq!(*stops.borrow(), 1);
    assert!(!manager.is_running());
}

#[test]
fn manager_start_mode_controls_whether_vrchat_process_is_required() {
    let service = RecordingOverlayService::default();
    let starts = service.starts.clone();
    let stops = service.stops.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(VrOverlayEligibility {
        game_running: false,
        ..eligible(WristOverlayStartMode::SteamVr)
    });
    assert!(manager.is_running());

    manager.reconcile(VrOverlayEligibility {
        game_running: false,
        ..eligible(WristOverlayStartMode::Vrchat)
    });
    assert!(!manager.is_running());

    assert_eq!(*starts.borrow(), 1);
    assert_eq!(*stops.borrow(), 1);
}

#[test]
fn manager_retries_start_immediately_after_ok_start_that_did_not_run() {
    let service = RecordingOverlayService {
        report_running_after_start: false,
        ..RecordingOverlayService::default()
    };
    let starts = service.starts.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(eligible(WristOverlayStartMode::Vrchat));
    manager.reconcile(eligible(WristOverlayStartMode::Vrchat));

    assert_eq!(*starts.borrow(), 2);
    assert!(!manager.is_running());
}

#[test]
fn manager_waits_for_retry_interval_after_runtime_unavailable_start_error() {
    let service = RecordingOverlayService {
        start_error: Some(OverlayServiceStartError::runtime_unavailable(
            "overlay backend error: OpenVR init failed: VRInitError_Init_NoServerForBackgroundApp",
        )),
        ..RecordingOverlayService::default()
    };
    let starts = service.starts.clone();
    let mut manager = VrOverlayManager::new(service);
    let eligibility = eligible(WristOverlayStartMode::Vrchat);

    manager.reconcile(eligibility);
    manager.reconcile(eligibility);

    assert_eq!(*starts.borrow(), 1);
    assert!(!manager.is_running());
}

#[test]
fn manager_blocks_retries_after_permanent_start_error_until_eligibility_changes() {
    let service = RecordingOverlayService {
        start_error: Some(OverlayServiceStartError::permanent(
            "overlay backend is unsupported by the current VR runtime: \
             OpenVR init failed: VRInitError_Init_InterfaceNotFound",
        )),
        ..RecordingOverlayService::default()
    };
    let starts = service.starts.clone();
    let mut manager = VrOverlayManager::new(service);
    let eligibility = eligible(WristOverlayStartMode::Vrchat);

    for _ in 0..5 {
        manager.reconcile(eligibility);
    }
    assert_eq!(*starts.borrow(), 1);

    let changed = VrOverlayEligibility {
        start_mode: WristOverlayStartMode::SteamVr,
        ..eligibility
    };
    manager.reconcile(changed);
    manager.reconcile(changed);
    assert_eq!(*starts.borrow(), 2);
}

#[test]
fn manager_permanent_block_clears_after_eligibility_drops_and_returns() {
    let service = RecordingOverlayService {
        start_error: Some(OverlayServiceStartError::permanent("unsupported runtime")),
        ..RecordingOverlayService::default()
    };
    let starts = service.starts.clone();
    let mut manager = VrOverlayManager::new(service);
    let eligibility = eligible(WristOverlayStartMode::Vrchat);

    manager.reconcile(eligibility);
    manager.reconcile(eligibility);
    assert_eq!(*starts.borrow(), 1);

    manager.reconcile(VrOverlayEligibility {
        game_running: false,
        ..eligibility
    });
    manager.reconcile(eligibility);
    manager.reconcile(eligibility);
    assert_eq!(*starts.borrow(), 2);
}

struct RecordingOverlayService {
    starts: std::rc::Rc<std::cell::RefCell<u32>>,
    stops: std::rc::Rc<std::cell::RefCell<u32>>,
    running: bool,
    report_running_after_start: bool,
    start_error: Option<OverlayServiceStartError>,
}

impl Default for RecordingOverlayService {
    fn default() -> Self {
        Self {
            starts: std::rc::Rc::new(std::cell::RefCell::new(0)),
            stops: std::rc::Rc::new(std::cell::RefCell::new(0)),
            running: false,
            report_running_after_start: true,
            start_error: None,
        }
    }
}

impl VrOverlayServiceControl for RecordingOverlayService {
    fn start(&mut self) -> Result<(), OverlayServiceStartError> {
        *self.starts.borrow_mut() += 1;
        if let Some(error) = &self.start_error {
            return Err(error.clone());
        }
        self.running = self.report_running_after_start;
        Ok(())
    }

    fn update_surface_frame(
        &mut self,
        _surface_id: &OverlaySurfaceId,
        _frame: RgbaFrame,
    ) -> Result<(), String> {
        Ok(())
    }

    fn set_surface_alpha(
        &mut self,
        _surface_id: &OverlaySurfaceId,
        _alpha: f32,
    ) -> Result<(), String> {
        Ok(())
    }

    fn show_surface(&mut self, _surface_id: &OverlaySurfaceId) -> Result<(), String> {
        Ok(())
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        Ok(Vec::new())
    }

    fn set_surface_configs(&mut self, _configs: Vec<OverlaySurfaceConfig>) -> Result<(), String> {
        Ok(())
    }

    fn stop(&mut self) {
        if self.running {
            *self.stops.borrow_mut() += 1;
            self.running = false;
        }
    }

    fn is_running(&self) -> bool {
        self.running
    }
}
