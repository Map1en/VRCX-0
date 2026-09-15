use std::sync::{Arc, Mutex};

use vrcx_0_application_core::{
    RealtimeNotificationProjection, RealtimeNotificationProjectionObserver, RuntimeAuthScope,
    RuntimeAuthScopeObserver, RuntimeAuthScopeSnapshot, TaskSpawnOutcome, TaskSupervisor,
};
use vrcx_0_persistence::notifications::notification_has_unseen_action_required;
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

use crate::host_actions::RuntimeHost;

#[derive(Default)]
struct IndicatorState {
    frontend_notify: bool,
    persisted_notify: bool,
    applied_notify: Option<bool>,
    sync_running: bool,
    sync_requested: bool,
}

impl IndicatorState {
    fn next_applied_notify(&mut self) -> Option<bool> {
        let notify = self.frontend_notify || self.persisted_notify;
        if self.applied_notify == Some(notify) {
            return None;
        }
        self.applied_notify = Some(notify);
        Some(notify)
    }
}

#[derive(Clone)]
pub(crate) struct RealtimeNotificationIndicator {
    db: Arc<DatabaseService>,
    config: ConfigRepository,
    auth_scope: RuntimeAuthScope,
    host: RuntimeHost,
    tasks: TaskSupervisor,
    state: Arc<Mutex<IndicatorState>>,
}

impl RealtimeNotificationIndicator {
    pub(crate) fn new(
        db: Arc<DatabaseService>,
        config: ConfigRepository,
        auth_scope: RuntimeAuthScope,
        host: RuntimeHost,
        tasks: TaskSupervisor,
    ) -> Self {
        Self {
            db,
            config,
            auth_scope,
            host,
            tasks,
            state: Arc::new(Mutex::new(IndicatorState::default())),
        }
    }

    pub(crate) fn set_frontend_notify(&self, notify: bool) {
        match self.state.lock() {
            Ok(mut state) => state.frontend_notify = notify,
            Err(error) => {
                tracing::warn!(error = %error, "failed to update frontend tray notification state");
            }
        }
        self.request_sync();
    }

    pub(crate) fn refresh(&self) {
        self.request_sync();
    }

    fn request_sync(&self) {
        {
            let Ok(mut state) = self.state.lock() else {
                tracing::warn!("failed to lock tray notification indicator state");
                return;
            };
            state.sync_requested = true;
            if state.sync_running {
                return;
            }
            state.sync_running = true;
        }

        let indicator = self.clone();
        if self
            .tasks
            .spawn_thread("tray-notification-indicator", move || {
                indicator.run_sync_loop()
            })
            != TaskSpawnOutcome::Scheduled
        {
            if let Ok(mut state) = self.state.lock() {
                state.sync_running = false;
            }
            tracing::warn!("failed to schedule tray notification indicator refresh");
        }
    }

    fn run_sync_loop(&self) {
        loop {
            if let Ok(mut state) = self.state.lock() {
                state.sync_requested = false;
            }
            let persisted = self.load_persisted_notify();
            let applied = match self.state.lock() {
                Ok(mut state) => {
                    if let Some(persisted) = persisted {
                        state.persisted_notify = persisted;
                    }
                    state.next_applied_notify()
                }
                Err(error) => {
                    tracing::warn!(error = %error, "failed to update persisted tray notification state");
                    None
                }
            };
            if let Some(applied) = applied {
                self.host.set_tray_icon_notification(applied);
            }
            let repeat = match self.state.lock() {
                Ok(state) if state.sync_requested => true,
                Ok(mut state) => {
                    state.sync_running = false;
                    false
                }
                Err(error) => {
                    tracing::warn!(error = %error, "failed to finish tray notification indicator refresh");
                    false
                }
            };
            if !repeat {
                return;
            }
        }
    }

    fn load_persisted_notify(&self) -> Option<bool> {
        let scope = self.auth_scope.snapshot();
        let enabled = self
            .config
            .get_bool("notificationIconDot", true)
            .unwrap_or(true);
        let notify = if enabled && scope.active {
            match notification_has_unseen_action_required(&self.db, &scope.current_user_id) {
                Ok(notify) => notify,
                Err(error) => {
                    tracing::warn!(error = %error, "failed to refresh tray notification indicator");
                    return None;
                }
            }
        } else {
            false
        };
        let current_scope = self.auth_scope.snapshot();
        if current_scope.generation != scope.generation
            || current_scope.current_user_id != scope.current_user_id
            || current_scope.endpoint != scope.endpoint
            || current_scope.active != scope.active
        {
            return None;
        }
        Some(notify)
    }
}

impl RealtimeNotificationProjectionObserver for RealtimeNotificationIndicator {
    fn observe_realtime_notification_projection(
        &self,
        _projection: &RealtimeNotificationProjection,
    ) {
        self.request_sync();
    }
}

impl RuntimeAuthScopeObserver for RealtimeNotificationIndicator {
    fn runtime_auth_scope_changed(&self, _snapshot: &RuntimeAuthScopeSnapshot) {
        self.request_sync();
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use serde_json::json;
    use vrcx_0_application_core::{RuntimeAuthScope, TaskSupervisor};
    use vrcx_0_persistence::notifications::notification_add_v1;
    use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

    use super::{IndicatorState, RealtimeNotificationIndicator};
    use crate::host_actions::{RuntimeHost, RuntimeHostActions};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-notification-indicator-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct LockCheckingActions {
        indicator: Arc<Mutex<Option<RealtimeNotificationIndicator>>>,
        tray_calls: Arc<Mutex<Vec<bool>>>,
    }

    impl RuntimeHostActions for LockCheckingActions {
        fn focus_main_window(&self) {}

        fn set_tray_icon_notification(&self, notify: bool) {
            let indicator = self.indicator.lock().unwrap();
            let indicator = indicator.as_ref().unwrap();
            assert!(indicator.state.try_lock().is_ok());
            self.tray_calls.lock().unwrap().push(notify);
        }
    }

    struct Fixture {
        _dir: TestDir,
        db: Arc<DatabaseService>,
        auth_scope: RuntimeAuthScope,
        indicator: RealtimeNotificationIndicator,
        tray_calls: Arc<Mutex<Vec<bool>>>,
    }

    fn fixture(name: &str) -> Fixture {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap());
        let auth_scope = RuntimeAuthScope::new();
        let host = RuntimeHost::new();
        let indicator_slot = Arc::new(Mutex::new(None));
        let tray_calls = Arc::new(Mutex::new(Vec::new()));
        host.set_actions(LockCheckingActions {
            indicator: Arc::clone(&indicator_slot),
            tray_calls: Arc::clone(&tray_calls),
        });
        let indicator = RealtimeNotificationIndicator::new(
            Arc::clone(&db),
            ConfigRepository::new(Arc::clone(&db)),
            auth_scope.clone(),
            host,
            TaskSupervisor::new(),
        );
        *indicator_slot.lock().unwrap() = Some(indicator.clone());
        Fixture {
            _dir: dir,
            db,
            auth_scope,
            indicator,
            tray_calls,
        }
    }

    fn wait_until_idle(indicator: &RealtimeNotificationIndicator) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if !indicator.state.lock().unwrap().sync_running {
                return;
            }
            assert!(Instant::now() < deadline, "indicator sync did not finish");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn persisted_and_frontend_sources_share_one_combined_output() {
        let mut state = IndicatorState {
            persisted_notify: true,
            ..IndicatorState::default()
        };

        assert_eq!(state.next_applied_notify(), Some(true));
        state.frontend_notify = true;
        assert_eq!(state.next_applied_notify(), None);
        state.persisted_notify = false;
        assert_eq!(state.next_applied_notify(), None);
        state.frontend_notify = false;
        assert_eq!(state.next_applied_notify(), Some(false));
    }

    #[test]
    fn tray_host_runs_on_the_sync_thread_after_indicator_state_is_unlocked() {
        let fixture = fixture("unlocked");

        fixture.indicator.set_frontend_notify(true);
        wait_until_idle(&fixture.indicator);
        assert_eq!(*fixture.tray_calls.lock().unwrap(), vec![true]);

        fixture.indicator.set_frontend_notify(false);
        wait_until_idle(&fixture.indicator);
        assert_eq!(*fixture.tray_calls.lock().unwrap(), vec![true, false]);
    }

    #[test]
    fn persisted_unseen_friend_request_keeps_tray_lit_after_frontend_clears() {
        let fixture = fixture("persisted");
        let user_id = "usr_owner";
        notification_add_v1(
            &fixture.db,
            user_id.into(),
            json!({
                "id": "friend_request",
                "createdAt": "2026-09-01T00:00:01Z",
                "type": "friendRequest",
                "senderUserId": "usr_sender"
            }),
        )
        .unwrap();

        fixture
            .auth_scope
            .set(user_id, "https://api.vrchat.cloud/api/1");
        fixture.indicator.refresh();
        wait_until_idle(&fixture.indicator);
        assert_eq!(*fixture.tray_calls.lock().unwrap(), vec![true]);

        fixture.indicator.set_frontend_notify(true);
        fixture.indicator.set_frontend_notify(false);
        wait_until_idle(&fixture.indicator);
        assert_eq!(*fixture.tray_calls.lock().unwrap(), vec![true]);

        fixture.auth_scope.set("", "");
        fixture.indicator.refresh();
        wait_until_idle(&fixture.indicator);
        assert_eq!(*fixture.tray_calls.lock().unwrap(), vec![true, false]);
    }
}
