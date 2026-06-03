use vrcx_0_host::vr_overlay::{OverlaySurfaceConfig, VrDeviceSnapshot};
use vrcx_0_runtime_host::vr_overlay::{
    VrOverlayEligibility, VrOverlayManager, VrOverlayServiceControl, WristOverlayStartMode,
};
use vrcx_0_vr_overlay::{OverlaySize, RgbaFrame};

#[test]
fn manager_does_not_start_overlay_service_until_all_eligibility_inputs_are_true() {
    let service = RecordingOverlayService::default();
    let starts = service.starts.clone();
    let stops = service.stops.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(VrOverlayEligibility {
        enabled: false,
        backend_available: true,
        vr_mode: true,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });
    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: false,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });
    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: true,
        steamvr_running: false,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });
    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: false,
        vr_mode: true,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
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

    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: true,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });
    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: true,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });
    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: false,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });

    assert_eq!(*starts.borrow(), 1);
    assert_eq!(*stops.borrow(), 1);
    assert!(!manager.is_running());
}

#[test]
fn manager_start_mode_controls_whether_vrchat_vr_mode_is_required() {
    let service = RecordingOverlayService::default();
    let starts = service.starts.clone();
    let stops = service.stops.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: false,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::SteamVr,
    });
    assert!(manager.is_running());

    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: false,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });
    assert!(!manager.is_running());

    assert_eq!(*starts.borrow(), 1);
    assert_eq!(*stops.borrow(), 1);
}

#[test]
fn manager_retries_start_when_service_reports_not_running_after_failure() {
    let service = RecordingOverlayService {
        report_running_after_start: false,
        ..RecordingOverlayService::default()
    };
    let starts = service.starts.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: true,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });
    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: true,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });

    assert_eq!(*starts.borrow(), 2);
    assert!(!manager.is_running());
}

#[test]
fn manager_backs_off_after_start_error() {
    let service = RecordingOverlayService {
        start_error: Some(
            "overlay backend error: OpenVR init failed: VRInitError_Init_NoServerForBackgroundApp"
                .to_string(),
        ),
        ..RecordingOverlayService::default()
    };
    let starts = service.starts.clone();
    let mut manager = VrOverlayManager::new(service);
    let eligibility = VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: true,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    };

    manager.reconcile(eligibility);
    manager.reconcile(eligibility);

    assert_eq!(*starts.borrow(), 1);
    assert!(!manager.is_running());
}

#[test]
fn manager_forwards_frames_and_show_to_running_service() {
    let service = RecordingOverlayService::default();
    let frames = service.frames.clone();
    let shows = service.shows.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        vr_mode: true,
        steamvr_running: true,
        start_mode: WristOverlayStartMode::VrchatVrMode,
    });
    manager
        .update_frame(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]))
        .expect("update frame");
    manager.show().expect("show overlay");

    assert_eq!(*frames.borrow(), 1);
    assert_eq!(*shows.borrow(), 1);
}

#[test]
fn manager_does_not_render_frames_when_service_is_not_running() {
    let service = RecordingOverlayService::default();
    let frames = service.frames.clone();
    let mut manager = VrOverlayManager::new(service);

    let result = manager.update_frame(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]));

    assert!(result.is_err());
    assert_eq!(*frames.borrow(), 0);
}

struct RecordingOverlayService {
    starts: std::rc::Rc<std::cell::RefCell<u32>>,
    stops: std::rc::Rc<std::cell::RefCell<u32>>,
    frames: std::rc::Rc<std::cell::RefCell<u32>>,
    shows: std::rc::Rc<std::cell::RefCell<u32>>,
    running: bool,
    report_running_after_start: bool,
    start_error: Option<String>,
}

impl Default for RecordingOverlayService {
    fn default() -> Self {
        Self {
            starts: std::rc::Rc::new(std::cell::RefCell::new(0)),
            stops: std::rc::Rc::new(std::cell::RefCell::new(0)),
            frames: std::rc::Rc::new(std::cell::RefCell::new(0)),
            shows: std::rc::Rc::new(std::cell::RefCell::new(0)),
            running: false,
            report_running_after_start: true,
            start_error: None,
        }
    }
}

impl VrOverlayServiceControl for RecordingOverlayService {
    fn start(&mut self) -> Result<(), String> {
        *self.starts.borrow_mut() += 1;
        if let Some(error) = &self.start_error {
            return Err(error.clone());
        }
        self.running = self.report_running_after_start;
        Ok(())
    }

    fn update_frame(&mut self, _frame: RgbaFrame) -> Result<(), String> {
        if !self.running {
            return Err("not running".to_string());
        }
        *self.frames.borrow_mut() += 1;
        Ok(())
    }

    fn show(&mut self) -> Result<(), String> {
        if !self.running {
            return Err("not running".to_string());
        }
        *self.shows.borrow_mut() += 1;
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
