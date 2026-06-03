use std::sync::{Arc, Mutex};

use serde_json::{json, Map, Value};
use vrcx_0_application::HostSessionRuntime;
use vrcx_0_application::ImageCache;
use vrcx_0_application::MutualGraphFetchRuntime;
use vrcx_0_application::OverlayActivityFilters;
use vrcx_0_application::OverlayActivityRuntime;
use vrcx_0_application::OverlayActivitySink;
use vrcx_0_application::OverlayActivitySnapshot;
use vrcx_0_application::RuntimeAuthScope;
use vrcx_0_application::RuntimeBackgroundJobs;
use vrcx_0_application::RuntimeDiagnostics;
use vrcx_0_application::RuntimeEventBus;
use vrcx_0_application::RuntimeLifecycle;
use vrcx_0_application::RuntimeSnapshot;
use vrcx_0_application::RuntimeSyncEngine;
use vrcx_0_application::TaskSupervisor;
use vrcx_0_application::WebClient;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::host_actions::RuntimeHost;

#[derive(Clone)]
struct OverlayActivityRuntimeEventSink {
    event_bus: RuntimeEventBus,
}

impl OverlayActivitySink for OverlayActivityRuntimeEventSink {
    fn emit_overlay_activity_snapshot(&self, snapshot: OverlayActivitySnapshot) {
        self.event_bus.emit_overlay_activity_snapshot(snapshot);
    }
}

struct OverlayActivityFanoutSink {
    sinks: Vec<Arc<dyn OverlayActivitySink>>,
}

impl OverlayActivityFanoutSink {
    fn new(sinks: Vec<Arc<dyn OverlayActivitySink>>) -> Self {
        Self { sinks }
    }
}

impl OverlayActivitySink for OverlayActivityFanoutSink {
    fn emit_overlay_activity_snapshot(&self, snapshot: OverlayActivitySnapshot) {
        for sink in &self.sinks {
            sink.emit_overlay_activity_snapshot(snapshot.clone());
        }
    }
}

#[derive(Clone)]
pub struct RuntimeHostContext {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: RuntimeEventBus,
    pub host: RuntimeHost,
    pub runtime: RuntimeLifecycle,
    pub background_jobs: RuntimeBackgroundJobs,
    pub sync: RuntimeSyncEngine,
    pub diagnostics: RuntimeDiagnostics,
    pub tasks: TaskSupervisor,
    pub session: HostSessionRuntime,
    pub auth_scope: RuntimeAuthScope,
    pub mutual_graph_fetch: MutualGraphFetchRuntime,
    pub overlay_activity: OverlayActivityRuntime,
    pub config: ConfigRepository,
    game_log_snapshot: Arc<Mutex<RuntimeSnapshot>>,
    now_playing: Arc<Mutex<Value>>,
}

impl RuntimeHostContext {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
    ) -> Self {
        let config = ConfigRepository::new(Arc::clone(&db));
        let event_bus = RuntimeEventBus::new();
        let overlay_activity = OverlayActivityRuntime::new();
        overlay_activity.set_sink(OverlayActivityRuntimeEventSink {
            event_bus: event_bus.clone(),
        });
        load_overlay_activity_filters(&config, &overlay_activity);
        Self {
            db,
            web,
            image_cache,
            event_bus,
            host: RuntimeHost::new(),
            runtime: RuntimeLifecycle::new(),
            background_jobs: RuntimeBackgroundJobs::new(),
            sync: RuntimeSyncEngine::new(),
            diagnostics: RuntimeDiagnostics::new(),
            tasks: TaskSupervisor::new(),
            session: HostSessionRuntime::new(),
            auth_scope: RuntimeAuthScope::new(),
            mutual_graph_fetch: MutualGraphFetchRuntime::new(),
            overlay_activity,
            config,
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            now_playing: Arc::new(Mutex::new(default_now_playing_value())),
        }
    }

    pub fn config(&self) -> &ConfigRepository {
        &self.config
    }

    pub fn reload_overlay_activity_filters(&self) {
        load_overlay_activity_filters(&self.config, &self.overlay_activity);
    }

    pub fn set_overlay_activity_extra_sink(&self, extra_sink: Arc<dyn OverlayActivitySink>) {
        self.overlay_activity
            .set_sink(OverlayActivityFanoutSink::new(vec![
                Arc::new(OverlayActivityRuntimeEventSink {
                    event_bus: self.event_bus.clone(),
                }),
                extra_sink,
            ]));
    }

    pub fn game_log_snapshot_handle(&self) -> Arc<Mutex<RuntimeSnapshot>> {
        Arc::clone(&self.game_log_snapshot)
    }

    pub fn game_log_snapshot(&self) -> RuntimeSnapshot {
        self.game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default()
    }

    pub fn now_playing(&self) -> Value {
        self.now_playing
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_else(|_| default_now_playing_value())
    }

    pub fn observe_runtime_event(&self, event: &str, payload: &Value) {
        if event != "gameLogSideEffect" {
            return;
        }

        let kind = payload
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match kind {
            "nowPlaying" => {
                let Some(patch) = payload.get("payload").and_then(Value::as_object) else {
                    return;
                };
                match self.now_playing.lock() {
                    Ok(mut current) => {
                        let mut merged = current
                            .as_object()
                            .cloned()
                            .unwrap_or_else(default_now_playing_map);
                        for (key, value) in patch {
                            merged.insert(key.clone(), value.clone());
                        }
                        *current = Value::Object(merged);
                    }
                    Err(error) => {
                        tracing::warn!("failed to lock now playing snapshot: {error}");
                    }
                }
            }
            "nowPlayingReset" => match self.now_playing.lock() {
                Ok(mut current) => {
                    *current = default_now_playing_value();
                }
                Err(error) => {
                    tracing::warn!("failed to lock now playing snapshot: {error}");
                }
            },
            _ => {}
        }
    }
}

fn default_now_playing_map() -> Map<String, Value> {
    default_now_playing_value()
        .as_object()
        .cloned()
        .unwrap_or_default()
}

fn default_now_playing_value() -> Value {
    json!({
        "url": "",
        "name": "",
        "source": "",
        "displayName": "",
        "thumbnailUrl": "",
        "length": 0,
        "position": 0,
        "startedAt": null,
        "updatedAt": null,
    })
}

fn load_overlay_activity_filters(config: &ConfigRepository, runtime: &OverlayActivityRuntime) {
    match config.get_raw("overlayActivityFilters") {
        Ok(Some(raw_value)) => match serde_json::from_str::<Value>(&raw_value) {
            Ok(value) if OverlayActivityFilters::has_persisted_rules(&value) => {
                runtime.set_filters(OverlayActivityFilters::from_json(value));
            }
            Ok(_) => {
                runtime.set_filters(load_legacy_overlay_activity_filters(config));
            }
            Err(error) => {
                tracing::warn!("failed to parse overlay activity filters: {error}");
                runtime.set_filters(load_legacy_overlay_activity_filters(config));
            }
        },
        Ok(None) => {
            runtime.set_filters(load_legacy_overlay_activity_filters(config));
        }
        Err(error) => {
            tracing::warn!("failed to load overlay activity filters: {error}");
            runtime.set_filters(OverlayActivityFilters::default());
        }
    }
}

fn load_legacy_overlay_activity_filters(config: &ConfigRepository) -> OverlayActivityFilters {
    match config.get_json("sharedFeedFilters", json!({})) {
        Ok(value) => {
            let filters = OverlayActivityFilters::from_legacy_shared_feed_filters(value.clone());
            if has_legacy_shared_wrist_filters(&value) {
                persist_migrated_overlay_activity_filters(config, &filters);
            }
            filters
        }
        Err(error) => {
            tracing::warn!("failed to load legacy shared feed filters: {error}");
            OverlayActivityFilters::default()
        }
    }
}

fn has_legacy_shared_wrist_filters(value: &Value) -> bool {
    value.get("wrist").and_then(Value::as_object).is_some()
}

fn persist_migrated_overlay_activity_filters(
    config: &ConfigRepository,
    filters: &OverlayActivityFilters,
) {
    let Ok(value) = serde_json::to_value(filters) else {
        return;
    };
    if let Err(error) = config.set_json("overlayActivityFilters", &value) {
        tracing::warn!("failed to persist migrated overlay activity filters: {error}");
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use vrcx_0_application::OverlayActivityScope;
    use vrcx_0_persistence::DatabaseService;

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-runtime-host-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn backend_load_migrates_legacy_shared_wrist_filters() -> Result<(), Box<dyn std::error::Error>>
    {
        let dir = TestDir::new("overlay-activity-config");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let config = ConfigRepository::new(db);
        config.set_json(
            "sharedFeedFilters",
            &json!({
                "noty": {
                    "Online": "Off"
                },
                "wrist": {
                    "invite": "VIP",
                    "friendRequest": "Off"
                }
            }),
        )?;
        let runtime = OverlayActivityRuntime::new();

        load_overlay_activity_filters(&config, &runtime);

        let saved = config.get_json("overlayActivityFilters", json!({}))?;
        let filters = OverlayActivityFilters::from_json(saved);
        assert_eq!(
            filters.rule_for("invite").scope,
            OverlayActivityScope::AllFavorites
        );
        assert_eq!(
            filters.rule_for("friendRequest").scope,
            OverlayActivityScope::Off
        );
        assert_eq!(
            config.get_json("sharedFeedFilters", json!({}))?,
            json!({
                "noty": {
                    "Online": "Off"
                },
                "wrist": {
                    "invite": "VIP",
                    "friendRequest": "Off"
                }
            })
        );
        Ok(())
    }
}
