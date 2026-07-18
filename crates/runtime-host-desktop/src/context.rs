use std::sync::{Arc, Mutex};

use serde_json::{json, Map, Value};
use vrcx_0_application_activity::{OverlayActivityRuntime, OverlayActivitySink};
use vrcx_0_application_game::RuntimeSnapshot;
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_host_desktop::tts::{SystemTtsEngine, TtsEngine};
#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_overlay_runtime::VrOverlayRuntimeServices;
use vrcx_0_runtime_host::notification::{
    extract_file_id, extract_file_version, fallback_file_version, normalize_avatar_image_url_128,
    RealtimeUserImageResolverSlot,
};
use vrcx_0_runtime_host::RuntimeHostContext;

use crate::host_actions::RuntimeHost;
use crate::notification::{
    DesktopNotifier, DesktopNotifierSlot, NotificationDispatcher, NotificationDispatcherDeps,
};

const AVATAR_PREFETCH_MAX_PATCHES: usize = 8;

pub struct DesktopRuntimeServices {
    data: Arc<RuntimeHostContext>,
    pub host: RuntimeHost,
    tts: Arc<dyn TtsEngine>,
    notification_desktop_notifier: DesktopNotifierSlot,
    realtime_user_image_resolver: RealtimeUserImageResolverSlot,
    game_log_snapshot: Arc<Mutex<RuntimeSnapshot>>,
    now_playing: Arc<Mutex<Value>>,
}

impl DesktopRuntimeServices {
    pub fn new(data: Arc<RuntimeHostContext>) -> Self {
        let tts: Arc<dyn TtsEngine> = Arc::new(SystemTtsEngine::new());
        let notification_desktop_notifier = DesktopNotifierSlot::default();
        let realtime_user_image_resolver = RealtimeUserImageResolverSlot::default();
        let notification_sink: Arc<dyn OverlayActivitySink> =
            Arc::new(NotificationDispatcher::new(NotificationDispatcherDeps {
                session: data.session.clone(),
                config: data.config.clone(),
                db: Arc::clone(&data.db),
                image_cache: Arc::clone(&data.image_cache),
                web: Arc::clone(&data.web),
                world_cache: Arc::clone(&data.world_cache),
                user_image_cache: data.notification_user_image_cache(),
                realtime_user_image_resolver: realtime_user_image_resolver.clone(),
                desktop: Arc::new(notification_desktop_notifier.clone()),
                tts: Arc::clone(&tts),
                tasks: data.tasks.clone(),
            }));
        data.add_overlay_activity_sink(notification_sink);
        Self {
            data,
            host: RuntimeHost::new(),
            tts,
            notification_desktop_notifier,
            realtime_user_image_resolver,
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            now_playing: Arc::new(Mutex::new(default_now_playing_value())),
        }
    }

    pub fn data(&self) -> &RuntimeHostContext {
        self.data.as_ref()
    }

    pub fn reload_overlay_activity_filters(&self) {
        self.data.reload_overlay_activity_filters();
    }

    pub fn set_overlay_activity_extra_sink(&self, extra_sink: Arc<dyn OverlayActivitySink>) {
        self.data.add_overlay_activity_sink(extra_sink);
    }

    pub fn set_notification_desktop_notifier(&self, desktop: Arc<dyn DesktopNotifier>) {
        self.notification_desktop_notifier.set(desktop);
    }

    pub fn set_realtime_user_image_resolver(&self, realtime_runtime: Arc<RealtimeHostRuntime>) {
        self.realtime_user_image_resolver.set(realtime_runtime);
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

    pub fn overlay_activity(&self) -> OverlayActivityRuntime {
        self.data.overlay_activity()
    }

    pub fn tts(&self) -> Arc<dyn TtsEngine> {
        Arc::clone(&self.tts)
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
            .data
            .session
            .snapshot()
            .realtime_context
            .map(|context| context.endpoint)
            .filter(|endpoint| !endpoint.is_empty())
        else {
            return;
        };
        let allow_user_icon = self
            .data
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
            let image_cache = Arc::clone(&self.data.image_cache);
            self.data.tasks.spawn(async move {
                let _ = image_cache.get_image(&normalized, &file_id, &version).await;
            });
        }
    }
}

#[cfg(any(windows, target_os = "linux"))]
impl VrOverlayRuntimeServices for DesktopRuntimeServices {
    fn data(&self) -> &RuntimeHostContext {
        DesktopRuntimeServices::data(self)
    }

    fn game_log_snapshot(&self) -> RuntimeSnapshot {
        DesktopRuntimeServices::game_log_snapshot(self)
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

#[cfg(test)]
mod tests;
