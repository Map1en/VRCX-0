use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::log_watcher::LogWatcher;
use vrcx_0_application_core::{GameProcessEvent, GameProcessEventSink};

const GAME_STOP_CONFIRMATION_POLLS: u8 = 3;

#[derive(Clone, Copy, Debug, Default)]
pub struct GameProcessStatus {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
}

pub trait GameProcessMonitorActions: Send + 'static {
    fn detect(&mut self) -> GameProcessStatus;
    fn on_game_started(&mut self, steamvr_running: bool);
    fn on_game_stopped(&mut self);
    fn on_steamvr_changed(&mut self, _steamvr_running: bool) {}
}

pub struct ProcessMonitor {
    game_running: Arc<AtomicBool>,
    steamvr_running: Arc<AtomicBool>,
    started: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self {
            game_running: Arc::new(AtomicBool::new(false)),
            steamvr_running: Arc::new(AtomicBool::new(false)),
            started: Arc::new(AtomicBool::new(false)),
            stop_requested: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
            handle: Mutex::new(None),
        }
    }

    pub fn start(
        &self,
        actions: impl GameProcessMonitorActions,
        log_watcher: LogWatcher,
        game_process_sinks: Vec<Arc<dyn GameProcessEventSink>>,
    ) {
        if self
            .started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
            && !self.stop_requested.load(Ordering::Acquire)
        {
            tracing::debug!("process monitor is already active");
            return;
        }
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.stop_requested.store(false, Ordering::Release);

        let game = Arc::clone(&self.game_running);
        let steamvr = Arc::clone(&self.steamvr_running);
        let started = Arc::clone(&self.started);
        let stop_requested = Arc::clone(&self.stop_requested);
        let current_generation = Arc::clone(&self.generation);

        let handle = std::thread::spawn(move || {
            let mut actions = actions;
            let mut first_poll = true;
            let mut consecutive_game_misses = 0;

            while !stop_requested.load(Ordering::Acquire)
                && current_generation.load(Ordering::Acquire) == generation
            {
                let status = actions.detect();
                let prev_game = game.load(Ordering::Relaxed);
                let game_found = resolve_debounced_game_running(
                    status.is_game_running,
                    prev_game,
                    &mut consecutive_game_misses,
                );
                let steamvr_found = status.is_steamvr_running;

                game.store(game_found, Ordering::Relaxed);
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

                dispatch_process_monitor_actions(
                    &mut actions,
                    first_poll,
                    game_changed,
                    steamvr_changed,
                    game_found,
                    steamvr_found,
                );
                if first_poll {
                    first_poll = false;
                }

                crate::sleep_interruptibly(Duration::from_secs(1), || {
                    !stop_requested.load(Ordering::Acquire)
                        && current_generation.load(Ordering::Acquire) == generation
                });
            }

            if current_generation.load(Ordering::Acquire) == generation {
                started.store(false, Ordering::Release);
            }
        });
        if let Ok(mut current) = self.handle.lock() {
            if let Some(previous) = current.take() {
                if previous.is_finished() {
                    let _ = previous.join();
                }
            }
            *current = Some(handle);
        }
    }

    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.stop_requested.store(true, Ordering::Release);
        self.started.store(false, Ordering::Release);
        if let Ok(mut handle) = self.handle.lock() {
            if let Some(handle) = handle.take() {
                let _ = handle.join();
            }
        }
    }

    pub fn is_game_running(&self) -> bool {
        self.game_running.load(Ordering::Relaxed)
    }

    pub fn is_steamvr_running(&self) -> bool {
        self.steamvr_running.load(Ordering::Relaxed)
    }
}

fn resolve_debounced_game_running(
    detected_running: bool,
    committed_running: bool,
    consecutive_misses: &mut u8,
) -> bool {
    if detected_running {
        *consecutive_misses = 0;
        return true;
    }
    if !committed_running {
        *consecutive_misses = 0;
        return false;
    }

    *consecutive_misses = consecutive_misses.saturating_add(1);
    *consecutive_misses < GAME_STOP_CONFIRMATION_POLLS
}

fn dispatch_process_monitor_actions(
    actions: &mut impl GameProcessMonitorActions,
    first_poll: bool,
    game_changed: bool,
    steamvr_changed: bool,
    game_found: bool,
    steamvr_found: bool,
) {
    if first_poll {
        if game_found {
            actions.on_game_started(steamvr_found);
        }
        return;
    }

    if game_changed {
        if game_found {
            actions.on_game_started(steamvr_found);
        } else {
            actions.on_game_stopped();
        }
        return;
    }

    if game_found && steamvr_changed {
        actions.on_steamvr_changed(steamvr_found);
    }
}

impl Default for ProcessMonitor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct RecordingActions {
        events: Vec<String>,
    }

    impl GameProcessMonitorActions for RecordingActions {
        fn detect(&mut self) -> GameProcessStatus {
            GameProcessStatus::default()
        }

        fn on_game_started(&mut self, steamvr_running: bool) {
            self.events.push(format!("started:{steamvr_running}"));
        }

        fn on_game_stopped(&mut self) {
            self.events.push("stopped".to_string());
        }

        fn on_steamvr_changed(&mut self, steamvr_running: bool) {
            self.events.push(format!("steamvr:{steamvr_running}"));
        }
    }

    #[test]
    fn first_poll_running_game_starts_actions() {
        let mut actions = RecordingActions::default();

        dispatch_process_monitor_actions(&mut actions, true, true, true, true, true);

        assert_eq!(actions.events, vec!["started:true"]);
    }

    #[test]
    fn game_start_after_steamvr_reports_vr_mode() {
        let mut actions = RecordingActions::default();

        dispatch_process_monitor_actions(&mut actions, false, true, false, true, true);

        assert_eq!(actions.events, vec!["started:true"]);
    }

    #[test]
    fn running_game_reacts_to_steamvr_changes() {
        let mut actions = RecordingActions::default();

        dispatch_process_monitor_actions(&mut actions, false, false, true, true, true);

        assert_eq!(actions.events, vec!["steamvr:true"]);
    }

    #[test]
    fn game_stop_requires_consecutive_misses() {
        let mut consecutive_misses = 0;

        for _ in 1..GAME_STOP_CONFIRMATION_POLLS {
            assert!(resolve_debounced_game_running(
                false,
                true,
                &mut consecutive_misses
            ));
        }
        assert!(!resolve_debounced_game_running(
            false,
            true,
            &mut consecutive_misses
        ));
    }

    #[test]
    fn detected_game_resets_pending_stop() {
        let mut consecutive_misses = 0;

        assert!(resolve_debounced_game_running(
            false,
            true,
            &mut consecutive_misses
        ));
        assert!(resolve_debounced_game_running(
            true,
            true,
            &mut consecutive_misses
        ));
        assert_eq!(consecutive_misses, 0);
        assert!(resolve_debounced_game_running(
            false,
            true,
            &mut consecutive_misses
        ));
    }

    #[test]
    fn stopped_game_does_not_delay_start_or_remain_pending() {
        let mut consecutive_misses = GAME_STOP_CONFIRMATION_POLLS - 1;

        assert!(!resolve_debounced_game_running(
            false,
            false,
            &mut consecutive_misses
        ));
        assert_eq!(consecutive_misses, 0);
        assert!(resolve_debounced_game_running(
            true,
            false,
            &mut consecutive_misses
        ));
    }
}
