use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Map, Value};
use vrcx_0_application::HostSessionRuntime;
use vrcx_0_application::ImageCache;
use vrcx_0_application::MutualGraphFetchRuntime;
use vrcx_0_application::OverlayActivityDelivery;
use vrcx_0_application::OverlayActivityFilters;
use vrcx_0_application::OverlayActivityRuntime;
use vrcx_0_application::OverlayActivitySink;
use vrcx_0_application::OverlayActivitySnapshot;
use vrcx_0_application::OverlayActivitySurfaceFilters;
use vrcx_0_application::PrintCleanupQueue;
use vrcx_0_application::RuntimeAuthScope;
use vrcx_0_application::RuntimeBackgroundJobs;
use vrcx_0_application::RuntimeDiagnostics;
use vrcx_0_application::RuntimeEventBus;
use vrcx_0_application::RuntimeLifecycle;
use vrcx_0_application::RuntimeSnapshot;
use vrcx_0_application::RuntimeSyncEngine;
use vrcx_0_application::TaskSupervisor;
use vrcx_0_application::WebClient;
use vrcx_0_application::WorldCache;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::host_actions::RuntimeHost;
use crate::notification::{
    DesktopNotifier, DesktopNotifierSlot, NotificationDispatcher, NotificationDispatcherDeps,
};

const WORLD_CACHE_WORKING_CAPACITY: u64 = 512;
const WORLD_CACHE_WORKING_TTL: Duration = Duration::from_secs(30 * 60);

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

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        for sink in &self.sinks {
            sink.emit_overlay_activity_delivery(delivery.clone());
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
    pub print_cleanup: PrintCleanupQueue,
    pub mutual_graph_fetch: MutualGraphFetchRuntime,
    pub overlay_activity: OverlayActivityRuntime,
    pub world_cache: Arc<WorldCache>,
    pub config: ConfigRepository,
    notification_desktop_notifier: DesktopNotifierSlot,
    overlay_activity_extra_sinks: Arc<Mutex<Vec<Arc<dyn OverlayActivitySink>>>>,
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
        let diagnostics = RuntimeDiagnostics::new();
        let tasks = TaskSupervisor::new();
        let session = HostSessionRuntime::new();
        let world_cache = Arc::new(WorldCache::new(
            Arc::clone(&db),
            WORLD_CACHE_WORKING_CAPACITY,
            WORLD_CACHE_WORKING_TTL,
        ));
        let notification_desktop_notifier = DesktopNotifierSlot::default();
        let notification_sink: Arc<dyn OverlayActivitySink> =
            Arc::new(NotificationDispatcher::new(NotificationDispatcherDeps {
                session: session.clone(),
                config: config.clone(),
                db: Arc::clone(&db),
                image_cache: Arc::clone(&image_cache),
                web: Arc::clone(&web),
                world_cache: Arc::clone(&world_cache),
                desktop: Arc::new(notification_desktop_notifier.clone()),
                event_bus: event_bus.clone(),
                diagnostics: diagnostics.clone(),
                tasks: tasks.clone(),
            }));
        overlay_activity.set_sink(OverlayActivityFanoutSink::new(vec![
            Arc::new(OverlayActivityRuntimeEventSink {
                event_bus: event_bus.clone(),
            }),
            Arc::clone(&notification_sink),
        ]));
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
            diagnostics,
            tasks,
            session,
            auth_scope: RuntimeAuthScope::new(),
            print_cleanup: PrintCleanupQueue::new(),
            mutual_graph_fetch: MutualGraphFetchRuntime::new(),
            overlay_activity,
            world_cache,
            config,
            notification_desktop_notifier,
            overlay_activity_extra_sinks: Arc::new(Mutex::new(vec![notification_sink])),
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
        match self.overlay_activity_extra_sinks.lock() {
            Ok(mut sinks) => sinks.push(extra_sink),
            Err(error) => {
                tracing::warn!("failed to lock overlay activity extra sinks: {error}");
                return;
            }
        }
        self.refresh_overlay_activity_sinks();
    }

    pub fn set_notification_desktop_notifier(&self, desktop: Arc<dyn DesktopNotifier>) {
        self.notification_desktop_notifier.set(desktop);
    }

    fn refresh_overlay_activity_sinks(&self) {
        let extra_sinks = match self.overlay_activity_extra_sinks.lock() {
            Ok(sinks) => sinks.clone(),
            Err(error) => {
                tracing::warn!("failed to lock overlay activity extra sinks: {error}");
                Vec::new()
            }
        };
        let mut sinks: Vec<Arc<dyn OverlayActivitySink>> =
            vec![Arc::new(OverlayActivityRuntimeEventSink {
                event_bus: self.event_bus.clone(),
            })];
        sinks.extend(extra_sinks);
        self.overlay_activity
            .set_sink(OverlayActivityFanoutSink::new(sinks));
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
    let mut filters = match config.get_raw("overlayActivityFilters") {
        Ok(Some(raw)) => match serde_json::from_str::<Value>(&raw) {
            Ok(value) if OverlayActivityFilters::has_persisted_rules(&value) => {
                OverlayActivityFilters::from_json(value)
            }
            Ok(_) => load_legacy_overlay_activity_filters(config),
            Err(error) => {
                tracing::warn!("failed to parse overlay activity filters: {error}");
                load_legacy_overlay_activity_filters(config)
            }
        },
        Ok(None) => load_legacy_overlay_activity_filters(config),
        Err(error) => {
            tracing::warn!("failed to load overlay activity filters: {error}");
            OverlayActivityFilters::default()
        }
    };

    if let Some(desktop) = load_types_key_surface(config, "desktopNotificationActivityFilters") {
        filters.desktop = desktop;
    }
    if let Some(vr) = load_types_key_surface(config, "vrNotificationActivityFilters") {
        filters.vr = vr;
    }
    if let Some(hmd) = load_types_key_surface(config, "hmdNotificationActivityFilters") {
        filters.hmd = hmd;
    }
    if let Some(webhook) = load_types_key_surface(config, "webhookActivityFilters") {
        filters.webhook = webhook;
    }
    runtime.set_filters(filters);
}

fn load_types_key_surface(
    config: &ConfigRepository,
    key: &str,
) -> Option<OverlayActivitySurfaceFilters> {
    let raw = config.get_raw(key).ok().flatten()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    value
        .get("types")
        .is_some_and(Value::is_object)
        .then(|| OverlayActivitySurfaceFilters::from_types_json(&value))
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

    use vrcx_0_application::{OverlayActivityScope, OverlayActivitySurface};
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
            filters
                .rule_for(OverlayActivitySurface::Wrist, "invite")
                .scope,
            OverlayActivityScope::AllFavorites
        );
        assert_eq!(
            filters
                .rule_for(OverlayActivitySurface::Wrist, "friendRequest")
                .scope,
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

    #[test]
    fn backend_load_reads_three_independent_surface_keys() -> Result<(), Box<dyn std::error::Error>>
    {
        let dir = TestDir::new("overlay-activity-three-keys");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let config = ConfigRepository::new(db);
        config.set_string(
            "overlayActivityFilters",
            &serde_json::to_string(&json!({
                "version": 1,
                "wrist": { "types": { "invite": { "scope": "on" } } }
            }))?,
        )?;
        config.set_string(
            "desktopNotificationActivityFilters",
            &serde_json::to_string(&json!({
                "version": 1,
                "types": { "invite": { "scope": "allFavorites" } }
            }))?,
        )?;
        config.set_string(
            "vrNotificationActivityFilters",
            &serde_json::to_string(&json!({
                "version": 1,
                "types": { "invite": { "scope": "off" } }
            }))?,
        )?;
        let runtime = OverlayActivityRuntime::new();

        load_overlay_activity_filters(&config, &runtime);

        let filters = runtime.filters();
        assert_eq!(
            filters
                .rule_for(OverlayActivitySurface::Wrist, "invite")
                .scope,
            OverlayActivityScope::On
        );
        assert_eq!(
            filters
                .rule_for(OverlayActivitySurface::Desktop, "invite")
                .scope,
            OverlayActivityScope::AllFavorites
        );
        assert_eq!(
            filters.rule_for(OverlayActivitySurface::Vr, "invite").scope,
            OverlayActivityScope::Off
        );
        Ok(())
    }

    #[test]
    fn backend_load_reads_webhook_surface_key() -> Result<(), Box<dyn std::error::Error>> {
        let dir = TestDir::new("overlay-activity-webhook-key");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let config = ConfigRepository::new(db);
        config.set_string(
            "webhookActivityFilters",
            &serde_json::to_string(&json!({
                "version": 1,
                "types": { "invite": { "scope": "on" } }
            }))?,
        )?;
        let runtime = OverlayActivityRuntime::new();

        load_overlay_activity_filters(&config, &runtime);

        let filters = runtime.filters();
        assert_eq!(
            filters
                .rule_for(OverlayActivitySurface::Webhook, "invite")
                .scope,
            OverlayActivityScope::On
        );
        Ok(())
    }
}
