use std::sync::Arc;

use vrcx_0_application_core::RuntimeEventPayload;

use crate::{DebugLoggingOutcome, GameLogProjection, RuntimeEventBus};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeNotificationLevel {
    Warning,
    Error,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeNotificationPayload {
    pub level: RuntimeNotificationLevel,
    pub title: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, specta::Type)]
pub struct EmptyEventPayload {}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameNoVrPayload {
    #[serde(rename = "isGameNoVR")]
    pub is_game_no_vr: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotProcessedPayload {
    pub path: String,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub titled: Option<bool>,
    #[serde(rename = "created_at", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub activity_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct NowPlayingSnapshot {
    pub url: String,
    pub name: String,
    pub source: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    pub thumbnail_url: String,
    pub length: i64,
    pub position: i64,
    pub started_at: Option<String>,
    pub paused: bool,
    pub titled: bool,
    #[serde(rename = "created_at", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub activity_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,
    pub updated_at: Option<String>,
}

impl NowPlayingSnapshot {
    pub fn apply(&mut self, patch: &NowPlayingPayload) {
        if let Some(value) = &patch.url {
            self.url.clone_from(value);
        }
        if let Some(value) = &patch.name {
            self.name.clone_from(value);
        }
        if let Some(value) = &patch.source {
            self.source.clone_from(value);
        }
        if let Some(value) = &patch.display_name {
            self.display_name.clone_from(value);
        }
        if let Some(value) = &patch.user_id {
            self.user_id = Some(value.clone());
        }
        if let Some(value) = &patch.location {
            self.location = Some(value.clone());
        }
        if let Some(value) = &patch.thumbnail_url {
            self.thumbnail_url.clone_from(value);
        }
        if let Some(value) = patch.length {
            self.length = value;
        }
        if let Some(value) = patch.position {
            self.position = value;
        }
        if let Some(value) = &patch.started_at {
            self.started_at = Some(value.clone());
        }
        if let Some(value) = patch.paused {
            self.paused = value;
        }
        if let Some(value) = patch.titled {
            self.titled = value;
        }
        if let Some(value) = &patch.created_at {
            self.created_at = Some(value.clone());
        }
        if let Some(value) = &patch.activity_type {
            self.activity_type = Some(value.clone());
        }
        if let Some(value) = &patch.video_url {
            self.video_url = Some(value.clone());
        }
        if let Some(value) = &patch.video_name {
            self.video_name = Some(value.clone());
        }
        if let Some(value) = &patch.video_id {
            self.video_id = Some(value.clone());
        }
        self.updated_at = Some(patch.updated_at.clone());
    }

    pub fn has_content(&self) -> bool {
        !self.url.trim().is_empty() || !self.name.trim().is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(tag = "kind", content = "payload")]
pub enum GameLogSideEffectEvent {
    #[serde(rename = "nowPlaying")]
    NowPlaying(Box<NowPlayingPayload>),
    #[serde(rename = "nowPlayingReset")]
    NowPlayingReset(EmptyEventPayload),
    #[serde(rename = "screenshotProcessed")]
    ScreenshotProcessed(ScreenshotProcessedPayload),
    #[serde(rename = "gameNoVR")]
    GameNoVr(GameNoVrPayload),
}

pub trait GameLogSideEffectObserver: Send + Sync {
    fn on_game_log_side_effect(&self, event: &GameLogSideEffectEvent);
}

#[derive(Clone)]
pub struct GameLogSideEffectSink {
    event_bus: RuntimeEventBus,
    observer: Option<Arc<dyn GameLogSideEffectObserver>>,
}

impl GameLogSideEffectSink {
    pub fn new(
        event_bus: RuntimeEventBus,
        observer: Option<Arc<dyn GameLogSideEffectObserver>>,
    ) -> Self {
        Self {
            event_bus,
            observer,
        }
    }

    pub fn emit(&self, event: GameLogSideEffectEvent) {
        if let Some(observer) = &self.observer {
            observer.on_game_log_side_effect(&event);
        }
        self.event_bus.emit(event);
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase", untagged)]
pub enum CrashRelaunchDecisionPayload {
    Failure {
        handled: bool,
        error: String,
    },
    Evaluated {
        handled: bool,
        location: String,
        #[serde(rename = "delayMs")]
        delay_ms: Option<u64>,
    },
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(tag = "kind", content = "payload")]
pub enum GameClientEvent {
    #[serde(rename = "crashRelaunchDecision")]
    CrashRelaunchDecision(CrashRelaunchDecisionPayload),
    #[serde(rename = "debugLoggingOutcome")]
    DebugLoggingOutcome(DebugLoggingOutcome),
    #[serde(rename = "notification")]
    Notification(RuntimeNotificationPayload),
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeGameLogEventPayload {
    pub raw: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogPersistenceFallbackPayload {
    pub attempted_row_count: u32,
    pub error: String,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeWorkerErrorPayload {
    pub worker: String,
    pub message: String,
}

macro_rules! runtime_event_payload {
    ($payload:ty, $event:literal) => {
        impl RuntimeEventPayload for $payload {
            const EVENT_NAME: &'static str = $event;
        }
    };
}

runtime_event_payload!(GameLogSideEffectEvent, "gameLogSideEffect");
runtime_event_payload!(GameClientEvent, "gameClientEvent");
runtime_event_payload!(RuntimeGameLogEventPayload, "addGameLogEvent");
runtime_event_payload!(GameLogProjection, "gameLogProjection");
runtime_event_payload!(
    GameLogPersistenceFallbackPayload,
    "gameLogPersistenceFallback"
);
runtime_event_payload!(RuntimeWorkerErrorPayload, "runtimeWorkerError");

pub trait RuntimeGameEventBusExt {
    fn emit_game_client_event(&self, event: GameClientEvent);
    fn emit_runtime_game_log_event(&self, payload: RuntimeGameLogEventPayload);
    fn emit_game_log_projection(&self, projection: GameLogProjection);
    fn emit_game_log_persistence_fallback(&self, payload: GameLogPersistenceFallbackPayload);
    fn emit_runtime_worker_error(&self, payload: RuntimeWorkerErrorPayload);
}

impl RuntimeGameEventBusExt for RuntimeEventBus {
    fn emit_game_client_event(&self, event: GameClientEvent) {
        self.emit(event);
    }

    fn emit_runtime_game_log_event(&self, payload: RuntimeGameLogEventPayload) {
        self.emit(payload);
    }

    fn emit_game_log_projection(&self, projection: GameLogProjection) {
        self.emit(projection);
    }

    fn emit_game_log_persistence_fallback(&self, payload: GameLogPersistenceFallbackPayload) {
        self.emit(payload);
    }

    fn emit_runtime_worker_error(&self, payload: RuntimeWorkerErrorPayload) {
        self.emit(payload);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use serde_json::json;
    use vrcx_0_application_core::{RuntimeEventBus, RuntimeEventPayload, RuntimeEventSink};

    use super::{
        CrashRelaunchDecisionPayload, EmptyEventPayload, GameClientEvent, GameLogSideEffectEvent,
        GameLogSideEffectObserver, GameLogSideEffectSink, NowPlayingPayload, NowPlayingSnapshot,
    };

    #[test]
    fn now_playing_reset_preserves_empty_payload_object() {
        assert_eq!(
            serde_json::to_value(GameLogSideEffectEvent::NowPlayingReset(
                EmptyEventPayload::default()
            ))
            .unwrap(),
            json!({ "kind": "nowPlayingReset", "payload": {} })
        );
    }

    #[test]
    fn now_playing_sync_preserves_sparse_wire_shape() {
        assert_eq!(
            serde_json::to_value(GameLogSideEffectEvent::NowPlaying(Box::new(
                NowPlayingPayload {
                    position: Some(42),
                    started_at: Some("start".into()),
                    updated_at: "update".into(),
                    ..Default::default()
                },
            )))
            .unwrap(),
            json!({
                "kind": "nowPlaying",
                "payload": {
                    "position": 42,
                    "startedAt": "start",
                    "updatedAt": "update",
                },
            })
        );
    }

    #[test]
    fn now_playing_full_payload_preserves_legacy_aliases() {
        assert_eq!(
            serde_json::to_value(GameLogSideEffectEvent::NowPlaying(Box::new(
                NowPlayingPayload {
                    url: Some("url".into()),
                    name: Some("name".into()),
                    source: Some("source".into()),
                    display_name: Some("display".into()),
                    user_id: Some("usr_test".into()),
                    location: Some("wrld_test:1".into()),
                    thumbnail_url: Some("thumbnail".into()),
                    length: Some(120),
                    position: Some(42),
                    started_at: Some("start".into()),
                    paused: Some(false),
                    titled: Some(true),
                    created_at: Some("start".into()),
                    activity_type: Some("VideoPlay".into()),
                    video_url: Some("url".into()),
                    video_name: Some("name".into()),
                    video_id: Some("source".into()),
                    updated_at: "update".into(),
                },
            )))
            .unwrap(),
            json!({
                "kind": "nowPlaying",
                "payload": {
                    "url": "url",
                    "name": "name",
                    "source": "source",
                    "displayName": "display",
                    "userId": "usr_test",
                    "location": "wrld_test:1",
                    "thumbnailUrl": "thumbnail",
                    "length": 120,
                    "position": 42,
                    "startedAt": "start",
                    "paused": false,
                    "titled": true,
                    "created_at": "start",
                    "type": "VideoPlay",
                    "videoUrl": "url",
                    "videoName": "name",
                    "videoId": "source",
                    "updatedAt": "update",
                },
            })
        );
    }

    #[test]
    fn now_playing_snapshot_default_preserves_legacy_wire_shape() {
        assert_eq!(
            serde_json::to_value(NowPlayingSnapshot::default()).unwrap(),
            json!({
                "url": "",
                "name": "",
                "source": "",
                "displayName": "",
                "thumbnailUrl": "",
                "length": 0,
                "position": 0,
                "startedAt": null,
                "paused": false,
                "titled": false,
                "updatedAt": null,
            })
        );
    }

    #[test]
    fn now_playing_snapshot_sparse_merge_preserves_legacy_wire_shape() {
        let mut snapshot = NowPlayingSnapshot::default();
        snapshot.apply(&NowPlayingPayload {
            name: Some("Test Track".into()),
            position: Some(42),
            started_at: Some("start".into()),
            updated_at: "update".into(),
            ..Default::default()
        });

        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            json!({
                "url": "",
                "name": "Test Track",
                "source": "",
                "displayName": "",
                "thumbnailUrl": "",
                "length": 0,
                "position": 42,
                "startedAt": "start",
                "paused": false,
                "titled": false,
                "updatedAt": "update",
            })
        );
    }

    #[test]
    fn crash_decision_preserves_null_delay_and_failure_shape() {
        assert_eq!(
            serde_json::to_value(GameClientEvent::CrashRelaunchDecision(
                CrashRelaunchDecisionPayload::Evaluated {
                    handled: false,
                    location: "wrld_test:1".into(),
                    delay_ms: None,
                }
            ))
            .unwrap(),
            json!({
                "kind": "crashRelaunchDecision",
                "payload": {
                    "handled": false,
                    "location": "wrld_test:1",
                    "delayMs": null,
                },
            })
        );
        assert_eq!(
            serde_json::to_value(GameClientEvent::CrashRelaunchDecision(
                CrashRelaunchDecisionPayload::Failure {
                    handled: false,
                    error: "boom".into(),
                }
            ))
            .unwrap(),
            json!({
                "kind": "crashRelaunchDecision",
                "payload": { "handled": false, "error": "boom" },
            })
        );
    }

    struct OrderingObserver(Arc<Mutex<Vec<&'static str>>>);

    impl GameLogSideEffectObserver for OrderingObserver {
        fn on_game_log_side_effect(&self, _event: &GameLogSideEffectEvent) {
            self.0.lock().unwrap().push("observer");
        }
    }

    struct OrderingTransport(Arc<Mutex<Vec<&'static str>>>);

    impl RuntimeEventSink for OrderingTransport {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            assert_eq!(event, GameLogSideEffectEvent::EVENT_NAME);
            assert_eq!(payload, json!({ "kind": "nowPlayingReset", "payload": {} }));
            self.0.lock().unwrap().push("transport");
        }
    }

    #[test]
    fn side_effect_observer_runs_before_outbound_transport() {
        let order = Arc::new(Mutex::new(Vec::new()));
        let bus = RuntimeEventBus::new();
        bus.set_sink(OrderingTransport(Arc::clone(&order)));
        let sink =
            GameLogSideEffectSink::new(bus, Some(Arc::new(OrderingObserver(Arc::clone(&order)))));

        sink.emit(GameLogSideEffectEvent::NowPlayingReset(
            EmptyEventPayload::default(),
        ));

        assert_eq!(*order.lock().unwrap(), ["observer", "transport"]);
    }
}
