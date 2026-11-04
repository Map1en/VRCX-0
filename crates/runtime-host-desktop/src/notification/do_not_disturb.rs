use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;
use vrcx_0_application_core::{ConfigStore, GameProcessEventSink, RuntimeEventBus, TaskSupervisor};
use vrcx_0_contracts::RuntimeEventPayload;
use vrcx_0_core::game_process::GameProcessEvent;

use crate::RuntimeHost;

const NOTIFICATION_DO_NOT_DISTURB_STATE_CONFIG_KEY: &str = "notificationDoNotDisturbState";
const NOTIFICATION_DO_NOT_DISTURB_END_ON_GAME_START_CONFIG_KEY: &str =
    "notificationDoNotDisturbEndOnGameStart";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationDoNotDisturbMode {
    #[default]
    Off,
    OneHour,
    ThreeHours,
    UntilStopped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDoNotDisturbSnapshot {
    pub revision: u64,
    pub mode: NotificationDoNotDisturbMode,
    pub ends_at: Option<String>,
}

impl RuntimeEventPayload for NotificationDoNotDisturbSnapshot {
    const EVENT_NAME: &'static str = "notificationDoNotDisturbState";
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedNotificationDoNotDisturbState {
    mode: NotificationDoNotDisturbMode,
    ends_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NotificationDoNotDisturbState {
    mode: NotificationDoNotDisturbMode,
    ends_at: Option<DateTime<Utc>>,
    revision: u64,
}

impl NotificationDoNotDisturbState {
    pub fn restore(
        mode: NotificationDoNotDisturbMode,
        ends_at: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Self {
        match mode {
            NotificationDoNotDisturbMode::OneHour | NotificationDoNotDisturbMode::ThreeHours
                if ends_at.is_some_and(|deadline| now < deadline) =>
            {
                Self {
                    mode,
                    ends_at,
                    revision: 0,
                }
            }
            NotificationDoNotDisturbMode::UntilStopped => Self {
                mode,
                ends_at: None,
                revision: 0,
            },
            _ => Self::default(),
        }
    }

    pub fn set_mode(&mut self, mode: NotificationDoNotDisturbMode, now: DateTime<Utc>) -> bool {
        let ends_at = match mode {
            NotificationDoNotDisturbMode::Off | NotificationDoNotDisturbMode::UntilStopped => None,
            NotificationDoNotDisturbMode::OneHour => Some(now + Duration::hours(1)),
            NotificationDoNotDisturbMode::ThreeHours => Some(now + Duration::hours(3)),
        };
        if self.mode == mode && self.ends_at == ends_at {
            return false;
        }
        self.mode = mode;
        self.ends_at = ends_at;
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub fn is_active(&self, now: DateTime<Utc>) -> bool {
        match self.mode {
            NotificationDoNotDisturbMode::Off => false,
            NotificationDoNotDisturbMode::OneHour | NotificationDoNotDisturbMode::ThreeHours => {
                self.ends_at.is_some_and(|deadline| now < deadline)
            }
            NotificationDoNotDisturbMode::UntilStopped => true,
        }
    }

    pub fn snapshot(&self, now: DateTime<Utc>) -> NotificationDoNotDisturbSnapshot {
        if !self.is_active(now) {
            return NotificationDoNotDisturbSnapshot {
                revision: self.revision,
                mode: NotificationDoNotDisturbMode::Off,
                ends_at: None,
            };
        }
        NotificationDoNotDisturbSnapshot {
            revision: self.revision,
            mode: self.mode,
            ends_at: self
                .ends_at
                .map(|deadline| deadline.to_rfc3339_opts(SecondsFormat::Millis, true)),
        }
    }

    pub fn on_game_process_event(
        &mut self,
        event: GameProcessEvent,
        end_on_start: bool,
        first_process_event: bool,
        now: DateTime<Utc>,
    ) -> bool {
        if first_process_event
            || !end_on_start
            || !event.game_changed
            || !event.is_game_running
            || !self.is_active(now)
        {
            return false;
        }
        self.set_mode(NotificationDoNotDisturbMode::Off, now)
    }
}

#[derive(Clone)]
pub struct NotificationDoNotDisturbRuntime {
    inner: Arc<NotificationDoNotDisturbRuntimeInner>,
}

struct NotificationDoNotDisturbRuntimeInner {
    state: Mutex<NotificationDoNotDisturbState>,
    seen_game_process_event: AtomicBool,
    config: Arc<dyn ConfigStore>,
    event_bus: RuntimeEventBus,
    host: RuntimeHost,
    expiration_changed: Notify,
}

impl NotificationDoNotDisturbRuntime {
    pub fn new(
        config: Arc<dyn ConfigStore>,
        event_bus: RuntimeEventBus,
        host: RuntimeHost,
        tasks: TaskSupervisor,
    ) -> vrcx_0_application_core::Result<Self> {
        let persisted =
            serde_json::from_value::<PersistedNotificationDoNotDisturbState>(config.get_json(
                NOTIFICATION_DO_NOT_DISTURB_STATE_CONFIG_KEY,
                serde_json::Value::Null,
            )?)
            .unwrap_or_default();
        let ends_at = persisted
            .ends_at
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc));
        let runtime = Self {
            inner: Arc::new(NotificationDoNotDisturbRuntimeInner {
                state: Mutex::new(NotificationDoNotDisturbState::restore(
                    persisted.mode,
                    ends_at,
                    Utc::now(),
                )),
                seen_game_process_event: AtomicBool::new(false),
                config,
                event_bus,
                host,
                expiration_changed: Notify::new(),
            }),
        };
        if let Err(error) = runtime.persist_current_state() {
            tracing::warn!(error = %error, "failed to persist restored do not disturb state");
        }
        let runtime_for_task = runtime.clone();
        tasks.spawn(async move {
            runtime_for_task.run_expiration_loop().await;
        });
        Ok(runtime)
    }

    pub fn snapshot(&self) -> NotificationDoNotDisturbSnapshot {
        self.inner
            .state
            .lock()
            .map(|state| state.snapshot(Utc::now()))
            .unwrap_or_else(|error| {
                tracing::warn!(error = %error, "failed to lock do not disturb state");
                NotificationDoNotDisturbState::default().snapshot(Utc::now())
            })
    }

    pub fn is_active(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| state.is_active(Utc::now()))
            .unwrap_or(false)
    }

    pub fn set_mode(
        &self,
        mode: NotificationDoNotDisturbMode,
    ) -> vrcx_0_application_core::Result<NotificationDoNotDisturbSnapshot> {
        let snapshot = self.update_state(|state| state.set_mode(mode, Utc::now()))?;
        self.inner.expiration_changed.notify_one();
        Ok(snapshot)
    }

    fn update_state(
        &self,
        update: impl FnOnce(&mut NotificationDoNotDisturbState) -> bool,
    ) -> vrcx_0_application_core::Result<NotificationDoNotDisturbSnapshot> {
        let mut state = self.inner.state.lock().map_err(|error| {
            vrcx_0_application_core::Error::Custom(format!(
                "do not disturb state lock poisoned: {error}"
            ))
        })?;
        let mut next = state.clone();
        let changed = update(&mut next);
        if !changed {
            return Ok(next.snapshot(Utc::now()));
        }
        self.persist_state(&next)?;
        let snapshot = next.snapshot(Utc::now());
        *state = next;
        drop(state);
        self.inner.host.refresh_tray_menu();
        self.inner.event_bus.emit(snapshot.clone());
        Ok(snapshot)
    }

    fn persist_current_state(&self) -> vrcx_0_application_core::Result<()> {
        let state = self.inner.state.lock().map_err(|error| {
            vrcx_0_application_core::Error::Custom(format!(
                "do not disturb state lock poisoned: {error}"
            ))
        })?;
        self.persist_state(&state)
    }

    fn persist_state(
        &self,
        state: &NotificationDoNotDisturbState,
    ) -> vrcx_0_application_core::Result<()> {
        let snapshot = state.snapshot(Utc::now());
        self.inner.config.set_json(
            NOTIFICATION_DO_NOT_DISTURB_STATE_CONFIG_KEY,
            &serde_json::to_value(PersistedNotificationDoNotDisturbState {
                mode: snapshot.mode,
                ends_at: snapshot.ends_at,
            })?,
        )?;
        Ok(())
    }

    async fn run_expiration_loop(self) {
        loop {
            let ends_at = self.inner.state.lock().ok().and_then(|state| state.ends_at);
            let Some(ends_at) = ends_at else {
                self.inner.expiration_changed.notified().await;
                continue;
            };
            let wait = (ends_at - Utc::now())
                .to_std()
                .unwrap_or(std::time::Duration::ZERO);
            tokio::select! {
                _ = tokio::time::sleep(wait) => {
                    if let Err(error) = self.update_state(|state| {
                        if state.is_active(Utc::now()) {
                            return false;
                        }
                        state.set_mode(NotificationDoNotDisturbMode::Off, Utc::now())
                    }) {
                        tracing::warn!(error = %error, "failed to expire do not disturb mode");
                    }
                }
                _ = self.inner.expiration_changed.notified() => {}
            }
        }
    }
}

impl GameProcessEventSink for NotificationDoNotDisturbRuntime {
    fn on_game_process_event(
        &self,
        event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        let first_process_event = !self
            .inner
            .seen_game_process_event
            .swap(true, Ordering::Relaxed);
        let end_on_start = self.inner.config.get_bool(
            NOTIFICATION_DO_NOT_DISTURB_END_ON_GAME_START_CONFIG_KEY,
            true,
        )?;
        self.update_state(|state| {
            state.on_game_process_event(event, end_on_start, first_process_event, Utc::now())
        })?;
        self.inner.expiration_changed.notify_one();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Utc};
    use vrcx_0_core::game_process::GameProcessEvent;

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use vrcx_0_application_core::{
        RuntimeEventBus, RuntimeVrchatAuthFailurePayload, TaskSupervisor,
    };

    use super::super::test_support::test_config;
    use super::{
        NotificationDoNotDisturbMode, NotificationDoNotDisturbRuntime,
        NotificationDoNotDisturbState,
    };
    use crate::{RuntimeHost, RuntimeHostActions};

    fn now() -> DateTime<Utc> {
        "2026-08-28T00:00:00Z".parse().unwrap()
    }

    #[test]
    fn timed_modes_use_relative_deadlines_and_expire_at_the_boundary() {
        let now = now();
        let mut state = NotificationDoNotDisturbState::default();

        assert!(state.set_mode(NotificationDoNotDisturbMode::OneHour, now));
        assert_eq!(
            state.snapshot(now).ends_at.as_deref(),
            Some("2026-08-28T01:00:00.000Z")
        );
        assert!(state.is_active(now + chrono::Duration::minutes(59)));
        assert!(!state.is_active(now + chrono::Duration::hours(1)));

        assert!(state.set_mode(NotificationDoNotDisturbMode::ThreeHours, now));
        assert_eq!(
            state.snapshot(now).ends_at.as_deref(),
            Some("2026-08-28T03:00:00.000Z")
        );
    }

    #[test]
    fn until_stopped_has_no_deadline_and_manual_stop_is_idempotent() {
        let now = now();
        let mut state = NotificationDoNotDisturbState::default();

        assert!(state.set_mode(NotificationDoNotDisturbMode::UntilStopped, now));
        assert!(state.is_active(now + chrono::Duration::days(30)));
        assert_eq!(state.snapshot(now).ends_at, None);
        assert!(state.set_mode(NotificationDoNotDisturbMode::Off, now));
        let revision = state.snapshot(now).revision;
        assert!(!state.set_mode(NotificationDoNotDisturbMode::Off, now));
        assert_eq!(state.snapshot(now).revision, revision);
    }

    #[test]
    fn selecting_the_same_timed_mode_restarts_its_relative_duration() {
        let now = now();
        let mut state = NotificationDoNotDisturbState::default();
        state.set_mode(NotificationDoNotDisturbMode::OneHour, now);

        let later = now + chrono::Duration::minutes(15);
        assert!(state.set_mode(NotificationDoNotDisturbMode::OneHour, later));
        assert_eq!(
            state.snapshot(later).ends_at.as_deref(),
            Some("2026-08-28T01:15:00.000Z")
        );
    }

    #[test]
    fn restore_preserves_the_absolute_deadline_and_normalizes_expired_state() {
        let now = now();
        let deadline = now + chrono::Duration::hours(1);
        let active = NotificationDoNotDisturbState::restore(
            NotificationDoNotDisturbMode::OneHour,
            Some(deadline),
            now + chrono::Duration::minutes(20),
        );
        assert_eq!(
            active.snapshot(now).ends_at.as_deref(),
            Some("2026-08-28T01:00:00.000Z")
        );

        let expired = NotificationDoNotDisturbState::restore(
            NotificationDoNotDisturbMode::OneHour,
            Some(deadline),
            deadline,
        );
        assert_eq!(
            expired.snapshot(deadline).mode,
            NotificationDoNotDisturbMode::Off
        );
    }

    #[test]
    fn game_start_stops_dnd_only_for_the_enabled_start_transition() {
        let now = now();
        let started = GameProcessEvent {
            is_game_running: true,
            is_steamvr_running: false,
            game_changed: true,
        };
        let mut state = NotificationDoNotDisturbState::default();
        state.set_mode(NotificationDoNotDisturbMode::UntilStopped, now);

        assert!(!state.on_game_process_event(started, false, false, now));
        assert!(state.is_active(now));
        assert!(state.on_game_process_event(started, true, false, now));
        assert!(!state.is_active(now));
    }

    #[test]
    fn the_first_process_event_never_stops_dnd() {
        let now = now();
        let already_running = GameProcessEvent {
            is_game_running: true,
            is_steamvr_running: true,
            game_changed: true,
        };
        let mut state = NotificationDoNotDisturbState::default();
        state.set_mode(NotificationDoNotDisturbMode::UntilStopped, now);

        assert!(!state.on_game_process_event(already_running, true, true, now));
        assert!(state.is_active(now));
        assert!(state.on_game_process_event(already_running, true, false, now));
        assert!(!state.is_active(now));
    }

    #[test]
    fn non_start_process_events_do_not_stop_dnd() {
        let now = now();
        for event in [
            GameProcessEvent {
                is_game_running: true,
                is_steamvr_running: true,
                game_changed: false,
            },
            GameProcessEvent {
                is_game_running: false,
                is_steamvr_running: false,
                game_changed: true,
            },
        ] {
            let mut state = NotificationDoNotDisturbState::default();
            state.set_mode(NotificationDoNotDisturbMode::UntilStopped, now);
            assert!(!state.on_game_process_event(event, true, false, now));
            assert!(state.is_active(now));
        }
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
    fn changing_the_mode_refreshes_the_host_tray_menu() {
        let (_dir, config) = test_config("dnd-tray-refresh");
        let host = RuntimeHost::new();
        let refreshes = Arc::new(AtomicUsize::new(0));
        host.set_actions(TrayRefreshActions {
            refreshes: Arc::clone(&refreshes),
        });
        let runtime = NotificationDoNotDisturbRuntime::new(
            config,
            RuntimeEventBus::new(),
            host,
            TaskSupervisor::new(),
        )
        .unwrap();

        runtime
            .set_mode(NotificationDoNotDisturbMode::UntilStopped)
            .unwrap();
        runtime
            .set_mode(NotificationDoNotDisturbMode::UntilStopped)
            .unwrap();

        assert_eq!(refreshes.load(Ordering::Relaxed), 1);
    }
}
