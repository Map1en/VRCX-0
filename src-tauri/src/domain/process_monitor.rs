use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sysinfo::{ProcessesToUpdate, System};

use super::auto_launch::AutoAppLaunchManager;
use super::log_watcher::LogWatcher;
use crate::error::AppError;

#[derive(Clone, Copy, Debug)]
pub struct GameProcessEvent {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub game_changed: bool,
}

pub trait GameProcessEventSink: Send + Sync {
    fn on_game_process_event(&self, event: GameProcessEvent) -> Result<(), AppError>;
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
            let mut sys = System::new();
            let mut first_poll = true;

            loop {
                sys.refresh_processes(ProcessesToUpdate::All, true);

                let mut game_found = false;
                let mut steamvr_found = false;

                for proc in sys.processes().values() {
                    let name = proc.name().to_string_lossy();
                    if !game_found && is_vrchat_process_name(&name) {
                        game_found = true;
                    }
                    if !steamvr_found && is_steamvr_process_name(&name) {
                        steamvr_found = true;
                    }
                    if game_found && steamvr_found {
                        break;
                    }
                }

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

pub fn detect_steamvr_running() -> bool {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .any(|proc| is_steamvr_process_name(&proc.name().to_string_lossy()))
}

pub fn detect_game_running() -> bool {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .any(|proc| is_vrchat_process_name(&proc.name().to_string_lossy()))
}

#[cfg(target_os = "linux")]
fn is_vrchat_process_name(name: &str) -> bool {
    name == "VRChat.exe"
}

#[cfg(not(target_os = "linux"))]
fn is_vrchat_process_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("VRChat.exe")
}

#[cfg(target_os = "linux")]
fn is_steamvr_process_name(name: &str) -> bool {
    name == "vrmonitor" || name == "monado-service" || name.ends_with("wivrn-server")
}

#[cfg(not(target_os = "linux"))]
fn is_steamvr_process_name(name: &str) -> bool {
    name.starts_with("vrserver")
}

#[cfg(test)]
mod tests {
    use super::{is_steamvr_process_name, is_vrchat_process_name};

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_vrchat_process_name_matches_vue_electron_backend() {
        assert!(is_vrchat_process_name("VRChat.exe"));
        assert!(!is_vrchat_process_name("VRChat"));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_steamvr_process_name_matches_vue_electron_backend() {
        assert!(is_steamvr_process_name("vrmonitor"));
        assert!(is_steamvr_process_name("monado-service"));
        assert!(is_steamvr_process_name("WiVRn-wivrn-server"));
        assert!(!is_steamvr_process_name("vrserver"));
    }

    #[test]
    #[cfg(not(target_os = "linux"))]
    fn non_linux_vrchat_process_name_matches_game_process_only() {
        assert!(is_vrchat_process_name("VRChat.exe"));
        assert!(is_vrchat_process_name("vrchat.exe"));
        assert!(!is_vrchat_process_name("VRChat"));
        assert!(!is_vrchat_process_name("VRChatHelper.exe"));
        assert!(is_steamvr_process_name("vrserver"));
        assert!(is_steamvr_process_name("vrserver.exe"));
    }
}
