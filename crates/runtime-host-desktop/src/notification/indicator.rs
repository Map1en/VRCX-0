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
    fn set_frontend_notify(&mut self, notify: bool) -> Option<bool> {
        self.frontend_notify = notify;
        self.next_applied_notify()
    }

    fn set_persisted_notify(&mut self, notify: bool) -> Option<bool> {
        self.persisted_notify = notify;
        self.next_applied_notify()
    }

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
            Ok(mut state) => {
                if let Some(applied) = state.set_frontend_notify(notify) {
                    self.host.set_tray_icon_notification(applied);
                }
            }
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
            self.sync_persisted_notify();
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

    fn sync_persisted_notify(&self) {
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
                    return;
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
            return;
        }
        match self.state.lock() {
            Ok(mut state) => {
                if let Some(applied) = state.set_persisted_notify(notify) {
                    self.host.set_tray_icon_notification(applied);
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to update persisted tray notification state");
            }
        }
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
    use super::IndicatorState;

    #[test]
    fn persisted_and_frontend_sources_share_one_combined_output() {
        let mut state = IndicatorState::default();

        assert_eq!(state.set_persisted_notify(true), Some(true));
        assert_eq!(state.set_frontend_notify(true), None);
        assert_eq!(state.set_persisted_notify(false), None);
        assert_eq!(state.set_frontend_notify(false), Some(false));
    }
}
