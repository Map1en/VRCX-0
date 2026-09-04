use std::sync::{Arc, Mutex};

pub trait RuntimeHostActions: Send + Sync {
    fn focus_main_window(&self);
    fn set_tray_icon_notification(&self, notify: bool);
}

#[derive(Clone, Default)]
pub struct RuntimeHost {
    state: Arc<Mutex<RuntimeHostState>>,
}

#[derive(Default)]
struct RuntimeHostState {
    actions: Option<Arc<dyn RuntimeHostActions>>,
    tray_icon_notification: Option<bool>,
}

impl RuntimeHost {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_actions<A>(&self, actions: A)
    where
        A: RuntimeHostActions + 'static,
    {
        let actions: Arc<dyn RuntimeHostActions> = Arc::new(actions);
        let tray_icon_notification = {
            let mut state = self.state.lock().unwrap();
            state.actions = Some(Arc::clone(&actions));
            state.tray_icon_notification
        };
        if let Some(notify) = tray_icon_notification {
            actions.set_tray_icon_notification(notify);
        }
    }

    pub fn focus_main_window(&self) {
        let actions = self.state.lock().unwrap().actions.clone();
        if let Some(actions) = actions {
            actions.focus_main_window();
        }
    }

    pub fn set_tray_icon_notification(&self, notify: bool) {
        let actions = {
            let mut state = self.state.lock().unwrap();
            state.tray_icon_notification = Some(notify);
            state.actions.clone()
        };
        if let Some(actions) = actions {
            actions.set_tray_icon_notification(notify);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::{RuntimeHost, RuntimeHostActions};

    struct LockCheckingActions {
        host: RuntimeHost,
        tray_calls: Arc<AtomicUsize>,
    }

    impl RuntimeHostActions for LockCheckingActions {
        fn focus_main_window(&self) {}

        fn set_tray_icon_notification(&self, _notify: bool) {
            assert!(self.host.state.try_lock().is_ok());
            self.tray_calls.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn tray_actions_run_after_runtime_host_state_is_unlocked() {
        let host = RuntimeHost::new();
        let tray_calls = Arc::new(AtomicUsize::new(0));
        host.set_tray_icon_notification(true);
        host.set_actions(LockCheckingActions {
            host: host.clone(),
            tray_calls: Arc::clone(&tray_calls),
        });
        host.set_tray_icon_notification(false);

        assert_eq!(tray_calls.load(Ordering::Relaxed), 2);
    }
}
