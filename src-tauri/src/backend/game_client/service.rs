use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use crate::backend::context::BackendContext;
use crate::domain::database::DatabaseService;
use crate::domain::image_cache::ImageCache;
use crate::domain::log_watcher::LogWatcher;
use crate::domain::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::domain::web_client::WebClient;
use crate::error::AppError;

use super::actions::{GameClientActions, SystemGameClientActions};
use super::lifecycle;

pub(super) struct GameClientState {
    pub external_notifier_version: i64,
    pub last_crash_at_ms: Option<i64>,
    pub session_active: bool,
    pub current_location: String,
}

#[derive(Clone)]
pub(super) struct GameClientDeps {
    pub context: BackendContext,
    pub log_watcher: LogWatcher,
    pub actions: Arc<dyn GameClientActions>,
    pub state: Arc<Mutex<GameClientState>>,
}

pub struct GameClientBackend {
    pub(super) context: BackendContext,
    pub(super) log_watcher: LogWatcher,
    pub(super) actions: Arc<dyn GameClientActions>,
    pub(super) state: Arc<Mutex<GameClientState>>,
}

impl GameClientBackend {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
        log_watcher: LogWatcher,
    ) -> Self {
        Self::new_with_actions(
            db,
            web,
            image_cache,
            log_watcher,
            Arc::new(SystemGameClientActions),
        )
    }

    fn new_with_actions(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
        log_watcher: LogWatcher,
        actions: Arc<dyn GameClientActions>,
    ) -> Self {
        Self {
            context: BackendContext::new(db, web, image_cache),
            log_watcher,
            actions,
            state: Arc::new(Mutex::new(GameClientState {
                external_notifier_version: 0,
                last_crash_at_ms: None,
                session_active: false,
                current_location: String::new(),
            })),
        }
    }

    pub fn set_app_handle(&self, app_handle: AppHandle) {
        self.context.event_bus.set_app_handle(app_handle);
    }

    pub fn set_runtime_state(&self, session_active: bool, current_location: &str) {
        let Ok(mut state) = self.state.lock() else {
            tracing::warn!("failed to lock GameClient runtime state");
            return;
        };
        state.session_active = session_active;
        state.current_location = current_location.trim().to_string();
    }

    pub(super) fn deps(&self) -> GameClientDeps {
        GameClientDeps {
            context: self.context.clone(),
            log_watcher: self.log_watcher.clone(),
            actions: Arc::clone(&self.actions),
            state: Arc::clone(&self.state),
        }
    }
}

impl GameProcessEventSink for GameClientBackend {
    fn on_game_process_event(&self, event: GameProcessEvent) -> Result<(), AppError> {
        if event.game_changed && !event.is_game_running {
            let deps = self.deps();
            if let Some(plan) = lifecycle::prepare_game_stopped(&deps)? {
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = lifecycle::execute_crash_relaunch(deps, plan).await {
                        tracing::warn!("GameClient stopped-game handling failed: {error}");
                    }
                });
            }
        }
        Ok(())
    }
}

#[cfg(test)]
impl GameClientBackend {
    pub(super) fn test_with_actions(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
        log_watcher: LogWatcher,
        actions: Arc<dyn GameClientActions>,
    ) -> Self {
        Self::new_with_actions(db, web, image_cache, log_watcher, actions)
    }
}
