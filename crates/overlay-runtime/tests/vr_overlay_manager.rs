use vrcx_0_host_desktop::vr_overlay::{OverlaySurfaceConfig, VrDeviceSnapshot};
use vrcx_0_overlay_runtime::{
    OverlayServiceStartError, VrOverlayEligibility, VrOverlayManager, VrOverlayServiceControl,
    WristOverlayStartMode,
};
use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId, RgbaFrame};

fn eligible(start_mode: WristOverlayStartMode) -> VrOverlayEligibility {
    VrOverlayEligibility {
        enabled: true,
        backend_available: true,
        game_running: true,
        vr_mode: true,
        steamvr_running: true,
        start_mode,
    }
}

#[test]
fn manager_does_not_start_vrchat_mode_until_required_eligibility_inputs_are_true() {
    let service = RecordingOverlayService::default();
    let starts = service.starts.clone();
    let stops = service.stops.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(VrOverlayEligibility {
        enabled: false,
        ..eligible(WristOverlayStartMode::VrchatVrMode)
    });
    manager.reconcile(VrOverlayEligibility {
        vr_mode: false,
        ..eligible(WristOverlayStartMode::VrchatVrMode)
    });
    manager.reconcile(VrOverlayEligibility {
        steamvr_running: false,
        ..eligible(WristOverlayStartMode::VrchatVrMode)
    });
    manager.reconcile(VrOverlayEligibility {
        game_running: false,
        ..eligible(WristOverlayStartMode::VrchatVrMode)
    });
    manager.reconcile(VrOverlayEligibility {
        backend_available: false,
        ..eligible(WristOverlayStartMode::VrchatVrMode)
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

    manager.reconcile(eligible(WristOverlayStartMode::VrchatVrMode));
    manager.reconcile(eligible(WristOverlayStartMode::VrchatVrMode));
    manager.reconcile(VrOverlayEligibility {
        vr_mode: false,
        ..eligible(WristOverlayStartMode::VrchatVrMode)
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
        game_running: false,
        vr_mode: false,
        ..eligible(WristOverlayStartMode::SteamVr)
    });
    assert!(manager.is_running());

    manager.reconcile(VrOverlayEligibility {
        vr_mode: false,
        ..eligible(WristOverlayStartMode::VrchatVrMode)
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

    manager.reconcile(eligible(WristOverlayStartMode::VrchatVrMode));
    manager.reconcile(eligible(WristOverlayStartMode::VrchatVrMode));

    assert_eq!(*starts.borrow(), 2);
    assert!(!manager.is_running());
}

#[test]
fn manager_backs_off_after_start_error() {
    let service = RecordingOverlayService {
        start_error: Some(OverlayServiceStartError::transient(
            "overlay backend error: OpenVR init failed: VRInitError_Init_NoServerForBackgroundApp",
        )),
        ..RecordingOverlayService::default()
    };
    let starts = service.starts.clone();
    let mut manager = VrOverlayManager::new(service);
    let eligibility = eligible(WristOverlayStartMode::VrchatVrMode);

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
    let eligibility = eligible(WristOverlayStartMode::VrchatVrMode);

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
    let eligibility = eligible(WristOverlayStartMode::VrchatVrMode);

    manager.reconcile(eligibility);
    manager.reconcile(eligibility);
    assert_eq!(*starts.borrow(), 1);

    manager.reconcile(VrOverlayEligibility {
        vr_mode: false,
        ..eligibility
    });
    manager.reconcile(eligibility);
    manager.reconcile(eligibility);
    assert_eq!(*starts.borrow(), 2);
}

#[test]
fn manager_forwards_frames_and_show_to_running_service() {
    let service = RecordingOverlayService::default();
    let frames = service.frames.clone();
    let shows = service.shows.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(eligible(WristOverlayStartMode::VrchatVrMode));
    manager
        .update_frame(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]))
        .expect("update frame");
    manager.show().expect("show overlay");

    assert_eq!(*frames.borrow(), 1);
    assert_eq!(*shows.borrow(), 1);
}

#[test]
fn manager_forwards_targeted_surface_frames_and_alpha() {
    let service = RecordingOverlayService::default();
    let surface_frames = service.surface_frames.clone();
    let surface_alpha = service.surface_alpha.clone();
    let mut manager = VrOverlayManager::new(service);

    manager.reconcile(eligible(WristOverlayStartMode::VrchatVrMode));
    manager
        .update_surface_frame(
            &OverlaySurfaceId::new("main"),
            RgbaFrame::new(OverlaySize::new(32, 16), vec![0; 32 * 16 * 4]),
        )
        .expect("update main frame");
    manager
        .set_surface_alpha(&OverlaySurfaceId::new("main"), 0.5)
        .expect("set alpha");

    assert_eq!(surface_frames.borrow().as_slice(), ["main:32x16"]);
    assert_eq!(surface_alpha.borrow().as_slice(), ["main:0.50"]);
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
    surface_frames: std::rc::Rc<std::cell::RefCell<Vec<String>>>,
    surface_alpha: std::rc::Rc<std::cell::RefCell<Vec<String>>>,
    shows: std::rc::Rc<std::cell::RefCell<u32>>,
    running: bool,
    report_running_after_start: bool,
    start_error: Option<OverlayServiceStartError>,
}

impl Default for RecordingOverlayService {
    fn default() -> Self {
        Self {
            starts: std::rc::Rc::new(std::cell::RefCell::new(0)),
            stops: std::rc::Rc::new(std::cell::RefCell::new(0)),
            frames: std::rc::Rc::new(std::cell::RefCell::new(0)),
            surface_frames: std::rc::Rc::new(std::cell::RefCell::new(Vec::new())),
            surface_alpha: std::rc::Rc::new(std::cell::RefCell::new(Vec::new())),
            shows: std::rc::Rc::new(std::cell::RefCell::new(0)),
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

    fn update_frame(&mut self, _frame: RgbaFrame) -> Result<(), String> {
        if !self.running {
            return Err("not running".to_string());
        }
        *self.frames.borrow_mut() += 1;
        Ok(())
    }

    fn update_surface_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        if !self.running {
            return Err("not running".to_string());
        }
        self.surface_frames.borrow_mut().push(format!(
            "{}:{}x{}",
            surface_id.as_str(),
            frame.size.width,
            frame.size.height
        ));
        Ok(())
    }

    fn set_surface_alpha(
        &mut self,
        surface_id: &OverlaySurfaceId,
        alpha: f32,
    ) -> Result<(), String> {
        if !self.running {
            return Err("not running".to_string());
        }
        self.surface_alpha
            .borrow_mut()
            .push(format!("{}:{alpha:.2}", surface_id.as_str()));
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
