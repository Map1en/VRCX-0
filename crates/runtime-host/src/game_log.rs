use std::sync::Arc;

use crate::context::RuntimeHostContext;
use crate::host_file_access::HostFileAccess;
use crate::log_watcher::{GameLogEvent, GameLogEventSink, LogWatcher};
use crate::Result;
use vrcx_0_application::Error as RuntimeError;
use vrcx_0_application::Result as RuntimeResult;
use vrcx_0_application::{GameLogHostActions, GameLogRuntime, GameLogRuntimeDeps};
use vrcx_0_application::{GameProcessEvent, GameProcessEventSink};
use vrcx_0_host::app_paths::AppPaths;
use vrcx_0_host::{clipboard, game_launch, vrchat_paths};

fn host_error(error: vrcx_0_host::Error) -> RuntimeError {
    match error {
        vrcx_0_host::Error::Io(error) => RuntimeError::Io(error),
        vrcx_0_host::Error::Json(error) => RuntimeError::Json(error),
        vrcx_0_host::Error::Custom(message) => RuntimeError::Custom(message),
    }
}

struct HostGameLogActions {
    file_access: HostFileAccess,
    app_paths: AppPaths,
}

impl GameLogHostActions for HostGameLogActions {
    fn quit_game(&self) -> i64 {
        i64::from(game_launch::quit_game())
    }

    fn copy_image_to_clipboard(&self, path: &str) -> RuntimeResult<()> {
        clipboard::copy_image_to_clipboard(path).map_err(host_error)
    }

    fn ugc_photo_location(&self, configured_path: Option<String>) -> String {
        let resolved = vrchat_paths::ugc_photo_location(configured_path);
        if self
            .file_access
            .ensure_write_allowed(&resolved, &self.app_paths)
            .is_ok()
        {
            return resolved;
        }
        let fallback = vrchat_paths::ugc_photo_location(None);
        if !fallback.is_empty() {
            tracing::warn!(
                path = %resolved,
                fallback = %fallback,
                "configured UGC path is not authorized; using VRChat photos folder"
            );
        }
        fallback
    }
}

pub struct GameLogHostRuntime {
    context: Arc<RuntimeHostContext>,
    inner: GameLogRuntime,
}

impl GameLogHostRuntime {
    pub fn new(
        context: Arc<RuntimeHostContext>,
        file_access: HostFileAccess,
        app_paths: AppPaths,
    ) -> Self {
        let inner = GameLogRuntime::new(GameLogRuntimeDeps {
            db: Arc::clone(&context.db),
            web: Arc::clone(&context.web),
            image_cache: Arc::clone(&context.image_cache),
            event_bus: context.event_bus.clone(),
            tasks: context.tasks.clone(),
            sync: context.sync.clone(),
            snapshot: context.game_log_snapshot_handle(),
            session: context.session.clone(),
            overlay_activity: context.overlay_activity.clone(),
            host_actions: Arc::new(HostGameLogActions {
                file_access,
                app_paths,
            }),
        });

        Self { context, inner }
    }

    pub fn prime_log_watcher(&self, log_watcher: &LogWatcher) -> Result<()> {
        let date_till = vrcx_0_persistence::game_log::get_last_game_log_date(&self.context.db)?;
        log_watcher.set_date_till(&date_till);
        Ok(())
    }

    pub fn stop(&self) {
        self.inner.stop();
    }
}

impl GameLogEventSink for GameLogHostRuntime {
    fn ingest_game_log_event(&self, event: &GameLogEvent) -> RuntimeResult<()> {
        self.inner.ingest_game_log_event(event)
    }

    fn ingest_game_log_events(&self, events: &[GameLogEvent]) -> RuntimeResult<()> {
        self.inner.ingest_game_log_events(events)
    }
}

impl GameProcessEventSink for GameLogHostRuntime {
    fn on_game_process_event(&self, event: GameProcessEvent) -> RuntimeResult<()> {
        self.inner.on_game_process_event(event)
    }
}
