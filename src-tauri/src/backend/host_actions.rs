use std::sync::{Arc, Mutex};

pub trait BackendHostActions: Send + Sync {
    fn focus_main_window(&self);
}

#[derive(Clone, Default)]
pub struct BackendHost {
    actions: Arc<Mutex<Option<Arc<dyn BackendHostActions>>>>,
}

impl BackendHost {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_actions<A>(&self, actions: A)
    where
        A: BackendHostActions + 'static,
    {
        *self.actions.lock().unwrap() = Some(Arc::new(actions));
    }

    pub fn focus_main_window(&self) {
        let actions = self.actions.lock().unwrap().clone();
        if let Some(actions) = actions {
            actions.focus_main_window();
        }
    }
}
