use std::sync::Arc;

use crate::log_watcher::LogWatcher;
use crate::{ensure_vrchat_launch_path_allowed, HostFileAccess, RuntimeHost};
use vrcx_0_application_core::Error as RuntimeError;
use vrcx_0_application_core::Result as RuntimeResult;
use vrcx_0_application_core::{
    BackendRuntimeStatusPublisher, GameProcessEvent, GameProcessEventSink, HostSessionRuntime,
    InstanceRosterObserver, RuntimeAuthScope, RuntimeEventBus, TaskSupervisor,
};
use vrcx_0_application_game::{
    GameClientActions, GameClientCacheActions, GameClientDebugLoggingActions,
    GameClientLocationSource, GameClientRuntime, GameClientRuntimeDeps, GameClientWindowActions,
};
use vrcx_0_core::game_log_parser::LogLocationSnapshot;
use vrcx_0_host_desktop::vrchat_registry;
use vrcx_0_host_desktop::{asset_bundle_cache, game_launch, process_status};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_platform::app_paths::AppPaths;

fn host_error(error: vrcx_0_platform::Error) -> RuntimeError {
    match error {
        vrcx_0_platform::Error::Io(error) => RuntimeError::Io(error),
        vrcx_0_platform::Error::Json(error) => RuntimeError::Json(error),
        vrcx_0_platform::Error::RegistryPolicyInvalid(message) => {
            RuntimeError::RegistryPolicyInvalid(message)
        }
        vrcx_0_platform::Error::Custom(message) => RuntimeError::Custom(message),
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

pub struct GameClientHostRuntimeDeps {
    pub db: Arc<DatabaseService>,
    pub event_bus: RuntimeEventBus,
    pub tasks: TaskSupervisor,
    pub session: HostSessionRuntime,
    pub auth_scope: RuntimeAuthScope,
    pub log_watcher: LogWatcher,
    pub file_access: HostFileAccess,
    pub app_paths: AppPaths,
    pub host: RuntimeHost,
    pub instance_roster_observer: Option<Arc<dyn InstanceRosterObserver>>,
    pub backend_status: BackendRuntimeStatusPublisher,
}

struct GameClientRuntimeHostDeps {
    db: Arc<DatabaseService>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    session: HostSessionRuntime,
    auth_scope: RuntimeAuthScope,
    log_watcher: LogWatcher,
    host: RuntimeHost,
    instance_roster_observer: Option<Arc<dyn InstanceRosterObserver>>,
    backend_status: BackendRuntimeStatusPublisher,
}

impl GameClientHostRuntime {
    pub fn new(deps: GameClientHostRuntimeDeps) -> Self {
        let actions = Arc::new(SystemGameClientActions {
            file_access: deps.file_access,
            app_paths: deps.app_paths,
        });
        Self::new_with_actions(
            GameClientRuntimeHostDeps {
                db: deps.db,
                event_bus: deps.event_bus,
                tasks: deps.tasks,
                session: deps.session,
                auth_scope: deps.auth_scope,
                log_watcher: deps.log_watcher,
                host: deps.host,
                instance_roster_observer: deps.instance_roster_observer,
                backend_status: deps.backend_status,
            },
            actions,
        )
    }

    fn new_with_actions(
        deps: GameClientRuntimeHostDeps,
        actions: Arc<dyn GameClientActions>,
    ) -> Self {
        let inner = GameClientRuntime::new(GameClientRuntimeDeps::new(
            Arc::new(crate::game_state_store::PersistenceGameStateStore::new(
                Arc::clone(&deps.db),
            )),
            deps.event_bus,
            deps.backend_status,
            deps.tasks,
            deps.session,
            deps.auth_scope,
            Arc::clone(&actions),
            Arc::new(SystemGameClientCacheActions),
            Arc::new(LogWatcherLocationSource {
                log_watcher: deps.log_watcher,
            }),
            Arc::new(RuntimeGameClientWindowActions { host: deps.host }),
            Arc::new(SystemGameClientDebugLoggingActions),
            deps.instance_roster_observer,
        ));

        Self { inner }
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
        db: Arc<DatabaseService>,
        event_bus: RuntimeEventBus,
        tasks: TaskSupervisor,
        session: HostSessionRuntime,
        auth_scope: RuntimeAuthScope,
        log_watcher: LogWatcher,
        actions: Arc<dyn GameClientActions>,
    ) -> Self {
        let backend_status = BackendRuntimeStatusPublisher::new(
            vrcx_0_application_core::BackendRuntime::new(
                vrcx_0_application_core::RuntimeHostProfile::Desktop,
            ),
            event_bus.clone(),
        );
        Self::new_with_actions(
            GameClientRuntimeHostDeps {
                db,
                event_bus,
                tasks,
                session,
                auth_scope,
                log_watcher,
                host: RuntimeHost::new(),
                instance_roster_observer: None,
                backend_status,
            },
            actions,
        )
    }
}
