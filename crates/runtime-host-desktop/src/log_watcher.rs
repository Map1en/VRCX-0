use std::path::Path;
use std::sync::{Arc, OnceLock, Weak};

use vrcx_0_application_game::LogLocationSnapshotScanner;
pub use vrcx_0_application_game::{
    GameLogEvent, GameLogEventOrigin, GameLogEventSink, LogLocationSnapshot, LogWatcher,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_contracts::{InstanceRosterObserver, InstanceRosterSnapshot};

#[derive(Default)]
pub struct HostLogLocationSnapshotScanner;

impl LogLocationSnapshotScanner for HostLogLocationSnapshotScanner {
    fn scan_current_location_snapshot(&self, log_dir: &Path) -> Option<LogLocationSnapshot> {
        vrcx_0_host_desktop::log_scanner::scan_current_location_snapshot(log_dir)
    }
}

pub struct HostInstanceRosterFanout {
    observers: Vec<Arc<dyn InstanceRosterObserver>>,
}

impl HostInstanceRosterFanout {
    pub fn new(observers: Vec<Arc<dyn InstanceRosterObserver>>) -> Self {
        Self { observers }
    }
}

impl InstanceRosterObserver for HostInstanceRosterFanout {
    fn on_instance_roster(&self, snapshot: InstanceRosterSnapshot) {
        for observer in &self.observers {
            observer.on_instance_roster(snapshot.clone());
        }
    }

    fn on_game_running(&self, running: bool) {
        for observer in &self.observers {
            observer.on_game_running(running);
        }
    }
}

#[derive(Default)]
pub struct CurrentUserLocalPresenceObserver {
    realtime: OnceLock<Weak<RealtimeHostRuntime>>,
}

impl CurrentUserLocalPresenceObserver {
    pub fn bind(&self, realtime: &Arc<RealtimeHostRuntime>) {
        let _ = self.realtime.set(Arc::downgrade(realtime));
    }
}

impl InstanceRosterObserver for CurrentUserLocalPresenceObserver {
    fn on_instance_roster(&self, _snapshot: InstanceRosterSnapshot) {
        if let Some(realtime) = self.realtime.get().and_then(Weak::upgrade) {
            realtime.refresh_current_user_local_presence();
        }
    }

    fn on_game_running(&self, _running: bool) {}
}
