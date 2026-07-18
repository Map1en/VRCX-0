use std::sync::Arc;

use crate::log_watcher::LogWatcher;
use crate::{ensure_vrchat_launch_path_allowed, HostFileAccess, RuntimeHost};
use vrcx_0_application_core::Error as RuntimeError;
use vrcx_0_application_core::Result as RuntimeResult;
use vrcx_0_application_core::{GameProcessEvent, GameProcessEventSink};
use vrcx_0_application_game::{
    GameClientActions, GameClientCacheActions, GameClientDebugLoggingActions,
    GameClientLocationSource, GameClientRuntime, GameClientRuntimeDeps, GameClientWindowActions,
};
use vrcx_0_core::log_watcher::LogLocationSnapshot;
use vrcx_0_host::app_paths::AppPaths;
use vrcx_0_host_desktop::vrchat_registry;
use vrcx_0_host_desktop::{asset_bundle_cache, game_launch, process_status};
use vrcx_0_runtime_host::RuntimeHostContext;

fn host_error(error: vrcx_0_host::Error) -> RuntimeError {
    match error {
        vrcx_0_host::Error::Io(error) => RuntimeError::Io(error),
        vrcx_0_host::Error::Json(error) => RuntimeError::Json(error),
        vrcx_0_host::Error::Custom(message) => RuntimeError::Custom(message),
    }
}

struct SystemGameClientActions {
    file_access: HostFileAccess,
    app_paths: AppPaths,
}

#[derive(Default)]
struct SystemGameClientDebugLoggingActions;

impl GameClientDebugLoggingActions for SystemGameClientDebugLoggingActions {
    fn read_debug_logging_enabled(&self) -> RuntimeResult<Option<bool>> {
        let value = vrchat_registry::get_registry_key("LOGGING_ENABLED").map_err(host_error)?;
        if value.is_null() || value.as_str().is_some_and(str::is_empty) {
            return Ok(None);
        }
        let enabled = value.as_f64() == Some(1.0)
            || value
                .as_str()
                .and_then(|value| value.trim().parse::<i32>().ok())
                == Some(1);
        Ok(Some(enabled))
    }

    fn enable_debug_logging(&self) -> RuntimeResult<bool> {
        vrchat_registry::set_registry_key("LOGGING_ENABLED", &serde_json::json!(1), 4)
            .map_err(host_error)
    }
}

impl GameClientActions for SystemGameClientActions {
    fn is_game_running(&self) -> bool {
        process_status::detect_game_running()
    }

    fn is_steamvr_running(&self) -> bool {
        process_status::detect_steamvr_running()
    }

    fn start_game(&self, arguments: &str) -> RuntimeResult<bool> {
        game_launch::start_game(arguments).map_err(host_error)
    }

    fn start_game_from_path(&self, path: &str, arguments: &str) -> RuntimeResult<bool> {
        let path = ensure_vrchat_launch_path_allowed(&self.file_access, &self.app_paths, path)
            .map_err(|error| RuntimeError::Custom(error.to_string()))?;
        game_launch::start_game_from_path(&path, arguments).map_err(host_error)
    }
}

#[derive(Default)]
struct SystemGameClientCacheActions;

impl GameClientCacheActions for SystemGameClientCacheActions {
    fn sweep_vrchat_cache(&self) -> Vec<String> {
        asset_bundle_cache::sweep_cache()
    }
}

#[derive(Clone)]
struct LogWatcherLocationSource {
    log_watcher: LogWatcher,
}

impl GameClientLocationSource for LogWatcherLocationSource {
    fn vrc_closed_gracefully(&self) -> bool {
        self.log_watcher.vrc_closed_gracefully()
    }

    fn current_location_snapshot(&self) -> Option<LogLocationSnapshot> {
        self.log_watcher.current_location_snapshot()
    }
}

#[derive(Clone)]
struct RuntimeGameClientWindowActions {
    host: RuntimeHost,
}

impl GameClientWindowActions for RuntimeGameClientWindowActions {
    fn focus_main_window(&self) {
        self.host.focus_main_window();
    }
}

pub struct GameClientHostRuntime {
    inner: GameClientRuntime,
}

impl GameClientHostRuntime {
    pub fn new(
        context: Arc<RuntimeHostContext>,
        log_watcher: LogWatcher,
        file_access: HostFileAccess,
        app_paths: AppPaths,
        host: RuntimeHost,
    ) -> Self {
        Self::new_with_actions(
            context,
            log_watcher,
            Arc::new(SystemGameClientActions {
                file_access,
                app_paths,
            }),
            host,
        )
    }

    fn new_with_actions(
        context: Arc<RuntimeHostContext>,
        log_watcher: LogWatcher,
        actions: Arc<dyn GameClientActions>,
        host: RuntimeHost,
    ) -> Self {
        let inner = GameClientRuntime::new(GameClientRuntimeDeps {
            db: Arc::clone(&context.db),
            config: context.config.clone(),
            event_bus: context.event_bus.clone(),
            tasks: context.tasks.clone(),
            session: context.session.clone(),
            auth_scope: context.auth_scope.clone(),
            actions: Arc::clone(&actions),
            cache_actions: Arc::new(SystemGameClientCacheActions),
            location_source: Arc::new(LogWatcherLocationSource { log_watcher }),
            window_actions: Arc::new(RuntimeGameClientWindowActions { host }),
            debug_logging_actions: Arc::new(SystemGameClientDebugLoggingActions),
        });

        Self { inner }
    }

    pub fn set_runtime_state(&self, current_location: &str) {
        self.inner.set_runtime_state(current_location);
    }

    pub fn stop(&self) {
        self.inner.stop();
    }

    pub fn debug_logging_outcome(&self) -> Option<vrcx_0_application_game::DebugLoggingOutcome> {
        self.inner.debug_logging_outcome()
    }

    #[cfg(feature = "test-utils")]
    pub fn wait_until_idle(&self) -> bool {
        self.inner.wait_until_idle()
    }
}

impl GameProcessEventSink for GameClientHostRuntime {
    fn on_game_process_event(&self, event: GameProcessEvent) -> RuntimeResult<()> {
        self.inner.on_game_process_event(event)
    }
}

#[cfg(any(test, feature = "test-utils"))]
impl GameClientHostRuntime {
    pub fn test_with_actions(
        context: Arc<RuntimeHostContext>,
        log_watcher: LogWatcher,
        actions: Arc<dyn GameClientActions>,
    ) -> Self {
        Self::new_with_actions(context, log_watcher, actions, RuntimeHost::new())
    }
}
