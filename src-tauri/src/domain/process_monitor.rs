use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

use super::auto_launch::AutoAppLaunchManager;

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

    pub fn start(&self, app_handle: AppHandle, auto_launch: AutoAppLaunchManager) {
        let game = Arc::clone(&self.game_running);
        let steamvr = Arc::clone(&self.steamvr_running);

        std::thread::spawn(move || {
            let mut sys = System::new();
            let mut first_poll = true;

            loop {
                sys.refresh_processes(ProcessesToUpdate::All, true);

                let mut game_found = false;
                let mut steamvr_found = false;

                for proc in sys.processes().values() {
                    let name = proc.name().to_string_lossy();
                    if !game_found && name.starts_with("VRChat") {
                        game_found = true;
                    }
                    if !steamvr_found && name.starts_with("vrserver") {
                        steamvr_found = true;
                    }
                    if game_found && steamvr_found {
                        break;
                    }
                }

                let prev_game = game.swap(game_found, Ordering::Relaxed);
                let prev_steamvr = steamvr.swap(steamvr_found, Ordering::Relaxed);

                if prev_game != game_found || prev_steamvr != steamvr_found {
                    let _ = app_handle.emit(
                        "updateIsGameRunning",
                        serde_json::json!({
                            "isGameRunning": game_found,
                            "isSteamVRRunning": steamvr_found,
                        }),
                    );
                }

                if first_poll {
                    first_poll = false;
                } else if prev_game != game_found {
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
