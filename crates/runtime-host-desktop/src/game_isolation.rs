use std::sync::{Arc, Mutex};

use serde::Serialize;
use vrcx_0_application_core::{
    LocalGameContextSnapshot, LocalGameContextSource, RuntimeEventBus, RuntimeEventPayload,
};
use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};
use vrcx_0_persistence::config::ConfigRepository;

use crate::RuntimeHost;

const GAME_ISOLATION_ENABLED_CONFIG_KEY: &str = "gameIsolationEnabled";
const GAME_ISOLATION_GAME_LOG_EFFECTIVE_CONFIG_KEY: &str = "gameIsolationGameLogEffective";
const GAME_LOG_PERSISTENCE_RESUME_AFTER_CONFIG_KEY: &str = "gameLogPersistenceResumeAfter";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameIsolationSnapshot {
    pub revision: u64,
    pub enabled: bool,
}

impl RuntimeEventPayload for GameIsolationSnapshot {
    const EVENT_NAME: &'static str = "gameIsolationState";
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct GameLogIsolationGate {
    effective: bool,
    dropped_through: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct GameLogGateOutcome {
    pub events: Vec<GameLogEvent>,
    pub effective_changed: Option<bool>,
    pub dropped_through: Option<String>,
}

impl GameLogIsolationGate {
    pub(crate) fn restore(effective: bool, dropped_through: Option<String>) -> Self {
        Self {
            effective,
            dropped_through,
        }
    }

    fn already_dropped(&self, created_at: &str) -> bool {
        let through = self
            .dropped_through
            .as_deref()
            .and_then(vrcx_0_application_game::parse_event_time_ms);
        through
            .zip(vrcx_0_application_game::parse_event_time_ms(created_at))
            .is_some_and(|(through, at)| at <= through)
    }

    pub(crate) fn filter(
        &mut self,
        requested: bool,
        events: &[GameLogEvent],
    ) -> Option<GameLogGateOutcome> {
        if !requested && !self.effective {
            return None;
        }
        let mut outcome = GameLogGateOutcome::default();
        for event in events {
            if matches!(event.kind, GameLogEventKind::Location { .. })
                && self.effective != requested
                && !self.already_dropped(&event.created_at)
            {
                self.effective = requested;
                outcome.effective_changed = Some(requested);
            }
            if self.effective {
                if !self.already_dropped(&event.created_at) {
                    self.dropped_through = Some(event.created_at.clone());
                }
                outcome.dropped_through = self.dropped_through.clone();
            } else {
                outcome.events.push(event.clone());
            }
        }
        Some(outcome)
    }
}

type GameIsolationObserver = Arc<dyn Fn(bool) + Send + Sync>;

#[derive(Clone)]
pub struct GameIsolationRuntime {
    inner: Arc<GameIsolationRuntimeInner>,
}

struct GameIsolationRuntimeInner {
    state: Mutex<GameIsolationSnapshot>,
    gate: Mutex<GameLogIsolationGate>,
    observers: Mutex<Vec<GameIsolationObserver>>,
    config: ConfigRepository,
    event_bus: RuntimeEventBus,
    host: RuntimeHost,
}

fn lock_error(error: impl std::fmt::Display) -> vrcx_0_application_core::Error {
    vrcx_0_application_core::Error::Custom(format!("game isolation state lock poisoned: {error}"))
}

impl GameIsolationRuntime {
    pub fn new(
        config: ConfigRepository,
        event_bus: RuntimeEventBus,
        host: RuntimeHost,
    ) -> vrcx_0_application_core::Result<Self> {
        let enabled = config.get_bool(GAME_ISOLATION_ENABLED_CONFIG_KEY, false)?;
        let effective = config.get_bool(GAME_ISOLATION_GAME_LOG_EFFECTIVE_CONFIG_KEY, enabled)?;
        let dropped_through =
            Some(config.get_string(GAME_LOG_PERSISTENCE_RESUME_AFTER_CONFIG_KEY, "")?)
                .filter(|value| !value.is_empty());
        Ok(Self {
            inner: Arc::new(GameIsolationRuntimeInner {
                state: Mutex::new(GameIsolationSnapshot {
                    revision: 0,
                    enabled,
                }),
                gate: Mutex::new(GameLogIsolationGate::restore(effective, dropped_through)),
                observers: Mutex::new(Vec::new()),
                config,
                event_bus,
                host,
            }),
        })
    }

    pub fn snapshot(&self) -> GameIsolationSnapshot {
        self.inner
            .state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub fn is_enabled(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| state.enabled)
            .unwrap_or(false)
    }

    pub fn add_observer(&self, observer: GameIsolationObserver) {
        if let Ok(mut observers) = self.inner.observers.lock() {
            observers.push(observer);
        }
    }

    pub fn set_enabled(
        &self,
        enabled: bool,
    ) -> vrcx_0_application_core::Result<GameIsolationSnapshot> {
        let mut state = self.inner.state.lock().map_err(lock_error)?;
        if state.enabled == enabled {
            return Ok(state.clone());
        }
        self.inner
            .config
            .set_bool(GAME_ISOLATION_ENABLED_CONFIG_KEY, enabled)?;
        state.enabled = enabled;
        state.revision = state.revision.wrapping_add(1);
        let snapshot = state.clone();
        drop(state);
        self.inner.host.refresh_tray_menu();
        self.inner.event_bus.emit(snapshot.clone());
        let observers = self
            .inner
            .observers
            .lock()
            .map(|observers| observers.clone())
            .unwrap_or_default();
        for observer in observers {
            observer(enabled);
        }
        Ok(snapshot)
    }

    pub(crate) fn ingest_game_log(
        &self,
        events: &[GameLogEvent],
        ingest: impl FnOnce(&[GameLogEvent]) -> vrcx_0_application_core::Result<()>,
    ) -> vrcx_0_application_core::Result<()> {
        let requested = self.is_enabled();
        let mut gate = self.inner.gate.lock().map_err(lock_error)?;
        let mut next = gate.clone();
        let Some(outcome) = next.filter(requested, events) else {
            drop(gate);
            return ingest(events);
        };
        ingest(&outcome.events)?;
        *gate = next;
        if let Some(effective) = outcome.effective_changed {
            self.inner
                .config
                .set_bool(GAME_ISOLATION_GAME_LOG_EFFECTIVE_CONFIG_KEY, effective)?;
        }
        if let Some(dropped_through) = outcome.dropped_through {
            let existing = self
                .inner
                .config
                .get_string(GAME_LOG_PERSISTENCE_RESUME_AFTER_CONFIG_KEY, "")?;
            if let Some(next) = crate::game_log::later_timestamp(&existing, &dropped_through) {
                if next != existing {
                    self.inner
                        .config
                        .set_string(GAME_LOG_PERSISTENCE_RESUME_AFTER_CONFIG_KEY, next)?;
                }
            }
        }
        Ok(())
    }
}

pub(crate) struct IsolatedLocalGameContextSource {
    inner: Arc<dyn LocalGameContextSource>,
    isolation: GameIsolationRuntime,
}

impl IsolatedLocalGameContextSource {
    pub(crate) fn new(
        inner: Arc<dyn LocalGameContextSource>,
        isolation: GameIsolationRuntime,
    ) -> Self {
        Self { inner, isolation }
    }
}

impl LocalGameContextSource for IsolatedLocalGameContextSource {
    fn snapshot(&self) -> LocalGameContextSnapshot {
        if self.isolation.is_enabled() {
            return LocalGameContextSnapshot::Unavailable;
        }
        self.inner.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use vrcx_0_application_core::{
        LocalGameContextSnapshot, LocalGameContextSource, RuntimeEventBus,
        RuntimeVrchatAuthFailurePayload,
    };
    use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};

    use super::{GameIsolationRuntime, GameLogIsolationGate, IsolatedLocalGameContextSource};
    use vrcx_0_persistence::config::ConfigRepository;

    use crate::notification::test_support::test_config;
    use crate::{RuntimeHost, RuntimeHostActions};

    fn isolation(config: &ConfigRepository) -> GameIsolationRuntime {
        GameIsolationRuntime::new(config.clone(), RuntimeEventBus::new(), RuntimeHost::new())
            .unwrap()
    }

    fn event(created_at: &str, kind: GameLogEventKind) -> GameLogEvent {
        GameLogEvent {
            file_name: "output_log_2026-10-28_20-00-00.txt".into(),
            created_at: created_at.into(),
            kind,
        }
    }

    fn joined(created_at: &str) -> GameLogEvent {
        event(
            created_at,
            GameLogEventKind::PlayerJoined {
                display_name: "Friend".into(),
                user_id: "usr_friend".into(),
            },
        )
    }

    fn left_room(created_at: &str) -> GameLogEvent {
        event(
            created_at,
            GameLogEventKind::LocationDestination {
                location: "wrld_next:2".into(),
            },
        )
    }

    fn entered_room(created_at: &str) -> GameLogEvent {
        event(
            created_at,
            GameLogEventKind::Location {
                location: "wrld_next:2".into(),
                world_name: "Next".into(),
            },
        )
    }

    fn created_at(events: &[GameLogEvent]) -> Vec<&str> {
        events
            .iter()
            .map(|event| event.created_at.as_str())
            .collect()
    }

    struct InGame;

    impl LocalGameContextSource for InGame {
        fn snapshot(&self) -> LocalGameContextSnapshot {
            LocalGameContextSnapshot::Available {
                is_game_running: true,
                location: "wrld_alt:1".into(),
                destination: String::new(),
                world_name: "Alt World".into(),
                player_user_ids: vec!["usr_friend".into()],
            }
        }
    }

    #[test]
    fn isolated_account_sees_no_local_game_and_gets_it_back_when_isolation_ends() {
        let (_dir, config) = test_config("game-isolation-local-context");
        let isolation = isolation(&config);
        let source = IsolatedLocalGameContextSource::new(Arc::new(InGame), isolation.clone());

        isolation.set_enabled(true).unwrap();
        assert_eq!(source.snapshot(), LocalGameContextSnapshot::Unavailable);
        assert!(!source.snapshot().with_game_running(true).is_game_running());

        isolation.set_enabled(false).unwrap();
        assert_eq!(source.snapshot(), InGame.snapshot());
    }

    #[test]
    fn never_isolated_game_log_passes_through_untouched() {
        let mut gate = GameLogIsolationGate::default();

        assert_eq!(
            gate.filter(false, &[joined("t1"), entered_room("t2")]),
            None
        );
    }

    #[test]
    fn enabling_mid_room_records_the_current_room_until_the_next_room_starts() {
        let mut gate = GameLogIsolationGate::default();

        let outcome = gate
            .filter(
                true,
                &[
                    joined("t1"),
                    left_room("t2"),
                    entered_room("t3"),
                    joined("t4"),
                ],
            )
            .unwrap();

        assert_eq!(created_at(&outcome.events), ["t1", "t2"]);
        assert_eq!(outcome.effective_changed, Some(true));
        assert_eq!(outcome.dropped_through.as_deref(), Some("t4"));
    }

    #[test]
    fn disabling_resumes_at_the_next_room_and_marks_the_skipped_span_as_replay_only() {
        let mut gate = GameLogIsolationGate::restore(true, None);

        let outcome = gate
            .filter(
                false,
                &[
                    joined("t1"),
                    left_room("t2"),
                    entered_room("t3"),
                    joined("t4"),
                ],
            )
            .unwrap();

        assert_eq!(created_at(&outcome.events), ["t3", "t4"]);
        assert_eq!(outcome.effective_changed, Some(false));
        assert_eq!(outcome.dropped_through.as_deref(), Some("t2"));
        assert_eq!(gate.filter(false, &[joined("t5")]), None);
    }

    #[test]
    fn restored_effective_isolation_keeps_dropping_until_the_next_room() {
        let mut gate = GameLogIsolationGate::restore(true, None);

        let outcome = gate
            .filter(false, &[joined("t1"), entered_room("t2")])
            .unwrap();

        assert_eq!(created_at(&outcome.events), ["t2"]);
        assert_eq!(outcome.dropped_through.as_deref(), Some("t1"));
    }

    struct TrayRefreshActions {
        refreshes: Arc<AtomicUsize>,
    }

    impl RuntimeHostActions for TrayRefreshActions {
        fn focus_main_window(&self) {}

        fn set_tray_icon_notification(&self, _notify: bool) {}

        fn vrchat_auth_failed(&self, _failure: &RuntimeVrchatAuthFailurePayload) {}

        fn refresh_tray_menu(&self) {
            self.refreshes.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn toggling_persists_refreshes_the_tray_and_notifies_observers_once_per_change() {
        let (_dir, config) = test_config("game-isolation-toggle");
        let host = RuntimeHost::new();
        let refreshes = Arc::new(AtomicUsize::new(0));
        host.set_actions(TrayRefreshActions {
            refreshes: Arc::clone(&refreshes),
        });
        let runtime =
            GameIsolationRuntime::new(config.clone(), RuntimeEventBus::new(), host).unwrap();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observed_for_callback = Arc::clone(&observed);
        runtime.add_observer(Arc::new(move |enabled| {
            observed_for_callback.lock().unwrap().push(enabled);
        }));

        runtime.set_enabled(true).unwrap();
        runtime.set_enabled(true).unwrap();
        runtime.set_enabled(false).unwrap();

        assert_eq!(refreshes.load(Ordering::Relaxed), 2);
        assert_eq!(*observed.lock().unwrap(), [true, false]);
        assert!(!config.get_bool("gameIsolationEnabled", true).unwrap());
    }

    fn ingest(runtime: &GameIsolationRuntime, events: &[GameLogEvent]) -> Vec<String> {
        let mut passed = Vec::new();
        runtime
            .ingest_game_log(events, |events| {
                passed.extend(events.iter().map(|event| event.created_at.clone()));
                Ok(())
            })
            .unwrap();
        passed
    }

    #[test]
    fn isolation_survives_restart_including_a_game_log_boundary_still_pending() {
        let (_dir, config) = test_config("game-isolation-restore");
        let runtime = isolation(&config);
        runtime.set_enabled(true).unwrap();
        ingest(&runtime, &[entered_room("2026-10-28T12:00:00.000Z")]);
        runtime.set_enabled(false).unwrap();

        let restarted = isolation(&config);

        assert!(!restarted.is_enabled());
        assert_eq!(
            ingest(
                &restarted,
                &[
                    joined("2026-10-28T12:05:00.000Z"),
                    entered_room("2026-10-28T12:10:00.000Z"),
                ],
            ),
            ["2026-10-28T12:10:00.000Z"]
        );
    }

    #[test]
    fn a_restart_before_the_next_room_never_replays_the_alt_account_into_history() {
        let (_dir, config) = test_config("game-isolation-replay");
        let runtime = isolation(&config);
        runtime.set_enabled(true).unwrap();
        let isolated_span = [
            entered_room("2026-10-28T12:00:00.000Z"),
            joined("2026-10-28T12:05:00.000Z"),
            entered_room("2026-10-28T12:10:00.000Z"),
            joined("2026-10-28T12:15:00.000Z"),
        ];
        assert!(ingest(&runtime, &isolated_span).is_empty());
        runtime.set_enabled(false).unwrap();

        let restarted = isolation(&config);
        let mut replay = isolated_span.to_vec();
        replay.push(joined("2026-10-28T12:20:00.000Z"));

        assert_eq!(ingest(&restarted, &replay), Vec::<String>::new());
        assert_eq!(
            config
                .get_string("gameLogPersistenceResumeAfter", "")
                .unwrap(),
            "2026-10-28T12:20:00.000Z"
        );
        assert_eq!(
            ingest(&restarted, &[entered_room("2026-10-28T12:30:00.000Z")]),
            ["2026-10-28T12:30:00.000Z"]
        );
    }

    #[test]
    fn toggling_while_a_game_log_batch_is_being_ingested_does_not_block() {
        let (_dir, config) = test_config("game-isolation-toggle-during-ingest");
        let runtime = isolation(&config);
        runtime.set_enabled(true).unwrap();

        runtime
            .ingest_game_log(&[joined("2026-10-28T12:00:00.000Z")], |_| {
                runtime.set_enabled(false).map(|_| ())
            })
            .unwrap();

        assert!(!runtime.is_enabled());
    }

    #[test]
    fn a_failed_ingest_retries_the_same_batch_with_the_same_boundary() {
        let (_dir, config) = test_config("game-isolation-retry");
        let runtime = isolation(&config);
        runtime.set_enabled(true).unwrap();
        let batch = [joined("t1"), entered_room("t2"), joined("t3")];

        let failed = runtime.ingest_game_log(&batch, |_| {
            Err(vrcx_0_application_core::Error::Custom(
                "database busy".into(),
            ))
        });

        assert!(failed.is_err());
        assert_eq!(ingest(&runtime, &batch), ["t1"]);
        assert_eq!(ingest(&runtime, &[joined("t4")]), Vec::<String>::new());
    }

    #[test]
    fn leaving_isolation_advances_the_persistence_resume_cutoff_but_never_rewinds_it() {
        let (_dir, config) = test_config("game-isolation-resume-after");
        config
            .set_string("gameLogPersistenceResumeAfter", "2026-10-28T11:00:00.000Z")
            .unwrap();
        let runtime = isolation(&config);
        runtime.set_enabled(true).unwrap();
        ingest(
            &runtime,
            &[
                entered_room("2026-10-28T12:00:00.000Z"),
                joined("2026-10-28T12:30:00.000Z"),
            ],
        );
        runtime.set_enabled(false).unwrap();
        ingest(&runtime, &[entered_room("2026-10-28T13:00:00.000Z")]);

        assert_eq!(
            config
                .get_string("gameLogPersistenceResumeAfter", "")
                .unwrap(),
            "2026-10-28T12:30:00.000Z"
        );

        config
            .set_string("gameLogPersistenceResumeAfter", "2026-10-28T23:00:00.000Z")
            .unwrap();
        runtime.set_enabled(true).unwrap();
        ingest(
            &runtime,
            &[
                entered_room("2026-10-28T14:00:00.000Z"),
                joined("2026-10-28T14:30:00.000Z"),
            ],
        );
        runtime.set_enabled(false).unwrap();
        ingest(&runtime, &[entered_room("2026-10-28T15:00:00.000Z")]);

        assert_eq!(
            config
                .get_string("gameLogPersistenceResumeAfter", "")
                .unwrap(),
            "2026-10-28T23:00:00.000Z"
        );
    }
}
