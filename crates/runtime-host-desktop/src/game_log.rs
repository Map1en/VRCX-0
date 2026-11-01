use std::sync::Arc;

use crate::game_isolation::GameIsolationRuntime;
use crate::log_watcher::{GameLogEvent, GameLogEventOrigin, GameLogEventSink, LogWatcher};
use crate::{HostFileAccess, Result};
use vrcx_0_application_activity::ActivityRouter;
use vrcx_0_application_core::Error as RuntimeError;
use vrcx_0_application_core::Result as RuntimeResult;
use vrcx_0_application_core::{
    BackendRuntimeStatusPublisher, GameProcessEvent, GameProcessEventSink, HostSessionRuntime,
    ImageCache, InstanceRosterObserver, RuntimeAuthScope, RuntimeEventBus, RuntimeSyncEngine,
    TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_application_game::{
    GameLogHostActions, GameLogRuntime, GameLogRuntimeDeps, GameLogSideEffectSink,
    RuntimeSnapshotStore,
};
use vrcx_0_host_desktop::{clipboard, game_launch, vrchat_paths};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_platform::app_paths::AppPaths;

pub(crate) const GAME_LOG_PERSISTENCE_RESUME_AFTER_CONFIG_KEY: &str =
    "gameLogPersistenceResumeAfter";

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

    fn add_screenshot_metadata(
        &self,
        path: &str,
        metadata: &str,
        world_id: &str,
        modify_filename: bool,
    ) -> String {
        vrcx_0_outbound_adapters::screenshots::add_screenshot_metadata(
            path,
            metadata,
            world_id,
            modify_filename,
        )
    }
}

pub struct GameLogHostRuntime {
    db: Arc<DatabaseService>,
    session: HostSessionRuntime,
    isolation: GameIsolationRuntime,
    inner: GameLogRuntime,
}

pub struct GameLogHostRuntimeDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: RuntimeEventBus,
    pub tasks: TaskSupervisor,
    pub sync: RuntimeSyncEngine,
    pub auth_scope: RuntimeAuthScope,
    pub session: HostSessionRuntime,
    pub world_cache: Arc<WorldCache>,
    pub file_access: HostFileAccess,
    pub app_paths: AppPaths,
    pub snapshot: RuntimeSnapshotStore,
    pub activity_router: ActivityRouter,
    pub instance_roster_observer: Option<Arc<dyn InstanceRosterObserver>>,
    pub backend_status: BackendRuntimeStatusPublisher,
    pub side_effect_sink: GameLogSideEffectSink,
    pub isolation: GameIsolationRuntime,
}

impl GameLogHostRuntime {
    pub fn new(deps: GameLogHostRuntimeDeps) -> Self {
        let instance_media: Arc<dyn vrcx_0_application_game::InstanceMediaPort> =
            Arc::new(crate::game_media::DesktopGameMediaAdapter::new(
                Arc::clone(&deps.web),
                Arc::clone(&deps.image_cache),
            ));
        let video_metadata: Arc<dyn vrcx_0_application_game::VideoMetadataPort> =
            Arc::new(crate::game_media::DesktopGameMediaAdapter::new(
                Arc::clone(&deps.web),
                Arc::clone(&deps.image_cache),
            ));
        let inner = GameLogRuntime::new(GameLogRuntimeDeps::new(
            Arc::new(crate::game_state_store::PersistenceGameStateStore::new(
                Arc::clone(&deps.db),
            )),
            instance_media,
            video_metadata,
            deps.event_bus,
            deps.backend_status,
            deps.side_effect_sink,
            deps.tasks,
            deps.sync,
            deps.auth_scope,
            deps.session.clone(),
            deps.snapshot,
            Arc::new(HostGameLogActions {
                file_access: deps.file_access,
                app_paths: deps.app_paths,
            }),
            Arc::new(deps.activity_router),
            Arc::clone(&deps.world_cache),
            deps.instance_roster_observer,
        ));

        Self {
            db: deps.db,
            session: deps.session,
            isolation: deps.isolation,
            inner,
        }
    }

    pub fn prime_log_watcher(&self, log_watcher: &LogWatcher) -> Result<()> {
        if vrcx_0_persistence::config::get_bool(&self.db, "gameLogDisabled", false)? {
            log_watcher.set_date_till("1970-01-01T00:00:00Z");
            log_watcher.set_initial_scan_latest_file_only(true);
            return Ok(());
        }
        let last_persisted = vrcx_0_persistence::game_log::get_last_game_log_date(&self.db)?;
        let resume_after = vrcx_0_persistence::config::get_string(
            &self.db,
            GAME_LOG_PERSISTENCE_RESUME_AFTER_CONFIG_KEY,
            "",
        )?;
        let date_till =
            later_timestamp(&last_persisted, &resume_after).unwrap_or(last_persisted.as_str());
        self.inner.set_persistence_resume_after(&resume_after);
        log_watcher.set_date_till(date_till);
        if let Some(cursor) = self.inner.replay_cursor() {
            log_watcher.resume_from(cursor);
        }
        log_watcher.set_initial_scan_latest_file_only(false);
        Ok(())
    }

    pub fn set_persistence_disabled(&self, log_watcher: &LogWatcher, disabled: bool) -> Result<()> {
        if self.session.snapshot().is_game_running {
            return Err(vrcx_0_application_core::Error::Custom(
                "VRChat must be closed before changing GameLog history persistence.".into(),
            )
            .into());
        }

        log_watcher
            .with_paused_scan(|| {
                let resume_after = if disabled {
                    String::new()
                } else {
                    vrcx_0_core::time::now_iso()
                };
                let mut values = vec![
                    vrcx_0_persistence::config::ConfigWriteEntry {
                        key: "gameLogDisabled".into(),
                        value: disabled.to_string(),
                    },
                    vrcx_0_persistence::config::ConfigWriteEntry {
                        key: "gameLogReplayCheckpoint".into(),
                        value: "".into(),
                    },
                ];
                if !disabled {
                    values.push(vrcx_0_persistence::config::ConfigWriteEntry {
                        key: GAME_LOG_PERSISTENCE_RESUME_AFTER_CONFIG_KEY.into(),
                        value: resume_after.clone(),
                    });
                }
                vrcx_0_persistence::config::config_set_values(&self.db, values)?;
                self.inner.reset_replay()?;
                self.inner.set_persistence_resume_after(&resume_after);
                log_watcher.clear_resume_cursor();
                log_watcher.set_initial_scan_latest_file_only(disabled);
                log_watcher.set_date_till(if disabled {
                    "1970-01-01T00:00:00Z"
                } else {
                    &resume_after
                });
                log_watcher.reset();
                Ok(())
            })
            .map_err(crate::Error::from)
    }

    pub fn stop(&self) {
        self.inner.stop();
    }
}

impl GameLogEventSink for GameLogHostRuntime {
    fn retry_pending_game_log(&self) -> RuntimeResult<()> {
        self.inner.retry_pending_game_log()
    }

    fn ingest_game_log_scan(
        &self,
        events: &[GameLogEvent],
        origin: GameLogEventOrigin,
        cursor: vrcx_0_application_game::GameLogScanCursor,
        publish: bool,
    ) -> RuntimeResult<()> {
        if publish {
            let account = cursor
                .authenticated_user()
                .filter(|_| self.session.snapshot().is_game_running)
                .map(|user| crate::LocalGameAccount {
                    user_id: user.user_id.clone(),
                    display_name: user.display_name.clone(),
                });
            self.isolation.set_local_game_account(account);
        }
        self.isolation.ingest_game_log(events, |events| {
            self.inner
                .ingest_game_log_scan(events, origin, cursor, publish)
        })
    }

    fn ingest_game_log_event(&self, event: &GameLogEvent) -> RuntimeResult<()> {
        self.isolation
            .ingest_game_log(std::slice::from_ref(event), |events| {
                events
                    .iter()
                    .try_for_each(|event| self.inner.ingest_game_log_event(event))
            })
    }

    fn ingest_game_log_events(&self, events: &[GameLogEvent]) -> RuntimeResult<()> {
        self.isolation
            .ingest_game_log(events, |events| self.inner.ingest_game_log_events(events))
    }

    fn ingest_game_log_events_with_origin(
        &self,
        events: &[GameLogEvent],
        origin: GameLogEventOrigin,
    ) -> RuntimeResult<()> {
        self.isolation.ingest_game_log(events, |events| {
            self.inner
                .ingest_game_log_events_with_origin(events, origin)
        })
    }
}

pub(crate) fn later_timestamp<'a>(left: &'a str, right: &'a str) -> Option<&'a str> {
    let left_at = vrcx_0_application_game::parse_event_time_ms(left);
    let right_at = vrcx_0_application_game::parse_event_time_ms(right);
    match (left_at, right_at) {
        (Some(left_at), Some(right_at)) => Some(if left_at >= right_at { left } else { right }),
        (Some(_), None) => Some(left),
        (None, Some(_)) => Some(right),
        (None, None) => None,
    }
}

impl GameProcessEventSink for GameLogHostRuntime {
    fn on_game_process_event(&self, event: GameProcessEvent) -> RuntimeResult<()> {
        if !event.is_game_running {
            self.isolation.set_local_game_account(None);
        }
        self.inner.on_game_process_event(event)
    }
}

#[cfg(test)]
mod tests {
    use super::later_timestamp;

    #[test]
    fn resume_cutoff_only_advances_the_watcher_boundary() {
        assert_eq!(
            later_timestamp("2026-08-06T10:00:00.000Z", "2026-08-06T11:00:00.000Z"),
            Some("2026-08-06T11:00:00.000Z")
        );
        assert_eq!(
            later_timestamp("2026-08-06T12:00:00.000Z", "2026-08-06T11:00:00.000Z"),
            Some("2026-08-06T12:00:00.000Z")
        );
        assert_eq!(
            later_timestamp("2026-08-06T12:00:00.000Z", ""),
            Some("2026-08-06T12:00:00.000Z")
        );
    }
}
