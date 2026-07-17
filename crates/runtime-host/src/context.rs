use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Map, Value};
use vrcx_0_application::HostSessionRuntime;
use vrcx_0_application::ImageCache;
use vrcx_0_application::LoginSessionRuntime;
use vrcx_0_application::MutualGraphFetchRuntime;
use vrcx_0_application::OverlayActivityDelivery;
use vrcx_0_application::OverlayActivityFilters;
use vrcx_0_application::OverlayActivityRuntime;
use vrcx_0_application::OverlayActivitySink;
use vrcx_0_application::OverlayActivitySnapshot;
use vrcx_0_application::OverlayActivitySurface;
use vrcx_0_application::OverlayActivitySurfaceFilters;
use vrcx_0_application::PrintCleanupQueue;
use vrcx_0_application::RealtimeHostRuntime;
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
use vrcx_0_host::tts::{SystemTtsEngine, TtsEngine};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::host_actions::RuntimeHost;
use crate::notification::image_file::{
    extract_file_id, extract_file_version, fallback_file_version,
};
use crate::notification::user_image::normalize_avatar_image_url_128;
use crate::notification::{
    DesktopNotifier, DesktopNotifierSlot, NotificationDispatcher, NotificationDispatcherDeps,
    RealtimeUserImageResolverSlot,
};

const WORLD_CACHE_WORKING_CAPACITY: u64 = 512;
const WORLD_CACHE_WORKING_TTL: Duration = Duration::from_secs(30 * 60);
const AVATAR_PREFETCH_MAX_PATCHES: usize = 8;

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
    pub login_session: LoginSessionRuntime,
    pub overlay_activity: OverlayActivityRuntime,
    pub world_cache: Arc<WorldCache>,
    pub config: ConfigRepository,
    pub tts: Arc<dyn TtsEngine>,
    notification_desktop_notifier: DesktopNotifierSlot,
    realtime_user_image_resolver: RealtimeUserImageResolverSlot,
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
        let tts: Arc<dyn TtsEngine> = Arc::new(SystemTtsEngine::new());
        let notification_desktop_notifier = DesktopNotifierSlot::default();
        let realtime_user_image_resolver = RealtimeUserImageResolverSlot::default();
        let notification_sink: Arc<dyn OverlayActivitySink> =
            Arc::new(NotificationDispatcher::new(NotificationDispatcherDeps {
                session: session.clone(),
                config: config.clone(),
                db: Arc::clone(&db),
                image_cache: Arc::clone(&image_cache),
                web: Arc::clone(&web),
                world_cache: Arc::clone(&world_cache),
                realtime_user_image_resolver: realtime_user_image_resolver.clone(),
                desktop: Arc::new(notification_desktop_notifier.clone()),
                tts: Arc::clone(&tts),
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
            login_session: LoginSessionRuntime::new(),
            overlay_activity,
            world_cache,
            config,
            tts,
            notification_desktop_notifier,
            realtime_user_image_resolver,
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

    pub fn set_realtime_user_image_resolver(&self, realtime_runtime: Arc<RealtimeHostRuntime>) {
        self.realtime_user_image_resolver.set(realtime_runtime);
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
        match event {
            "gameLogSideEffect" => self.observe_game_log_side_effect(payload),
            "realtimeFriendProjection" => self.prefetch_online_friend_avatars(payload),
            _ => {}
        }
    }

    fn observe_game_log_side_effect(&self, payload: &Value) {
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

    fn prefetch_online_friend_avatars(&self, payload: &Value) {
        let Some(patches) = payload.get("patches").and_then(Value::as_array) else {
            return;
        };
        if patches.len() > AVATAR_PREFETCH_MAX_PATCHES {
            return;
        }
        let Some(endpoint) = self
            .session
            .snapshot()
            .realtime_context
            .map(|context| context.endpoint)
            .filter(|endpoint| !endpoint.is_empty())
        else {
            return;
        };
        let allow_user_icon = self
            .config
            .get_bool("displayVRCPlusIconsAsAvatar", true)
            .unwrap_or(true);
        for patch in patches {
            let state_bucket = patch
                .get("stateBucket")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if state_bucket != "online" {
                continue;
            }
            let user_id = patch
                .get("userId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !user_id.starts_with("usr_") {
                continue;
            }
            let Some(raw_url) =
                self.realtime_user_image_resolver
                    .cached_url(&endpoint, user_id, allow_user_icon)
            else {
                continue;
            };
            let normalized = normalize_avatar_image_url_128(&raw_url, &endpoint);
            let Some(file_id) = extract_file_id(&normalized) else {
                continue;
            };
            let version = extract_file_version(&normalized, &file_id)
                .unwrap_or_else(|| fallback_file_version(&normalized));
            if version.is_empty() {
                continue;
            }
            let image_cache = Arc::clone(&self.image_cache);
            self.tasks.spawn(async move {
                let _ = image_cache.get_image(&normalized, &file_id, &version).await;
            });
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
            Ok(_) => OverlayActivityFilters::default(),
            Err(error) => {
                tracing::warn!("failed to parse overlay activity filters: {error}");
                OverlayActivityFilters::default()
            }
        },
        Ok(None) => OverlayActivityFilters::default(),
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
    if let Some(tts) = load_types_key_surface(config, "ttsNotificationActivityFilters") {
        filters.tts = tts;
    } else {
        filters.tts = seed_tts_notification_activity_filters(config, &filters);
    }
    runtime.set_filters(filters);
}

fn seed_tts_notification_activity_filters(
    config: &ConfigRepository,
    filters: &OverlayActivityFilters,
) -> OverlayActivitySurfaceFilters {
    let mut seeded = filters.desktop.clone();
    let activity_types = filters
        .desktop
        .types
        .keys()
        .chain(filters.vr.types.keys())
        .collect::<BTreeSet<_>>();
    for activity_type in activity_types {
        let desktop_rule = filters.rule_for(OverlayActivitySurface::Desktop, activity_type);
        if desktop_rule.scope == vrcx_0_application::OverlayActivityScope::Off {
            let vr_rule = filters.rule_for(OverlayActivitySurface::Vr, activity_type);
            if vr_rule.scope != vrcx_0_application::OverlayActivityScope::Off {
                seeded.types.insert(activity_type.clone(), vr_rule);
            }
        } else {
            seeded.types.insert(activity_type.clone(), desktop_rule);
        }
    }
    if let Ok(value) = serde_json::to_value(&seeded) {
        if let Err(error) = config.set_json("ttsNotificationActivityFilters", &value) {
            tracing::warn!("failed to persist seeded TTS activity filters: {error}");
        }
    }
    seeded
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

#[cfg(test)]
mod tests;
