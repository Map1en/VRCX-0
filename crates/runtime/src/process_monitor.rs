use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::log_watcher::LogWatcher;
pub use vrcx_0_core::game_process::GameProcessEvent;
use vrcx_0_host::auto_launch::AutoAppLaunchManager;
use vrcx_0_host::process_status::ProcessStatusDetector;

pub trait GameProcessEventSink: Send + Sync {
    fn on_game_process_event(&self, event: GameProcessEvent) -> crate::Result<()>;
}

pub struct ProcessMonitor {
    game_running: Arc<AtomicBool>,
    steamvr_running: Arc<AtomicBool>,
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self {
            game_running: Arc::new(AtomicBool::new(false)),
            steamvr_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(
        &self,
        auto_launch: AutoAppLaunchManager,
        log_watcher: LogWatcher,
        game_process_sinks: Vec<Arc<dyn GameProcessEventSink>>,
    ) {
        let game = Arc::clone(&self.game_running);
        let steamvr = Arc::clone(&self.steamvr_running);

        std::thread::spawn(move || {
            let mut detector = ProcessStatusDetector::new();
            let mut first_poll = true;

            loop {
                let status = detector.detect();
                let game_found = status.is_game_running;
                let steamvr_found = status.is_steamvr_running;

                let prev_game = game.swap(game_found, Ordering::Relaxed);
                let prev_steamvr = steamvr.swap(steamvr_found, Ordering::Relaxed);
                let game_changed = prev_game != game_found;
                let steamvr_changed = prev_steamvr != steamvr_found;

                if first_poll || game_changed {
                    log_watcher.set_game_running(game_found);
                }

                if first_poll || game_changed || steamvr_changed {
                    for sink in &game_process_sinks {
                        if let Err(error) = sink.on_game_process_event(GameProcessEvent {
                            is_game_running: game_found,
                            is_steamvr_running: steamvr_found,
                            game_changed,
                        }) {
                            tracing::warn!("failed to handle game process event: {error}");
                        }
                    }
                }

                if first_poll {
                    first_poll = false;
                } else if game_changed {
                    if game_found {
                        auto_launch.on_game_started(steamvr_found);
                    } else {
                        auto_launch.on_game_stopped();
                    }
                }

                std::thread::sleep(Duration::from_secs(1));
            }
        });
    }

    pub fn is_game_running(&self) -> bool {
        self.game_running.load(Ordering::Relaxed)
    }

    pub fn is_steamvr_running(&self) -> bool {
        self.steamvr_running.load(Ordering::Relaxed)
    }
}

impl Default for ProcessMonitor {
    fn default() -> Self {
        Self::new()
    }
}
