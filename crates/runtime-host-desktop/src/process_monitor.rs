use vrcx_0_application_game::{GameProcessMonitorActions, GameProcessStatus};
use vrcx_0_host_desktop::auto_launch::AutoAppLaunchManager;
use vrcx_0_host_desktop::process_status::ProcessStatusDetector;

pub struct HostGameProcessMonitorActions {
    auto_launch: AutoAppLaunchManager,
    detector: ProcessStatusDetector,
}

impl HostGameProcessMonitorActions {
    pub fn new(auto_launch: AutoAppLaunchManager) -> Self {
        Self {
            auto_launch,
            detector: ProcessStatusDetector::new(),
        }
    }
}

impl GameProcessMonitorActions for HostGameProcessMonitorActions {
    fn detect(&mut self) -> GameProcessStatus {
        let status = self.detector.detect();
        GameProcessStatus {
            is_game_running: status.is_game_running,
            is_steamvr_running: status.is_steamvr_running,
        }
    }

    fn on_game_started(&mut self, steamvr_running: bool) {
        self.auto_launch.on_game_started(steamvr_running);
    }

    fn on_game_stopped(&mut self) {
        self.auto_launch.on_game_stopped();
    }

    fn on_steamvr_changed(&mut self, steamvr_running: bool) {
        self.auto_launch.on_steamvr_changed(steamvr_running);
    }
}
