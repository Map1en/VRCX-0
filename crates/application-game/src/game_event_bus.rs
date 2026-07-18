use vrcx_0_application_core::RuntimeEventPayload;
use vrcx_0_persistence::game_log::GameLogWriteBatch;

use crate::{DebugLoggingOutcome, GameLogProjection, RuntimeEventBus};

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeNotificationPayload {
    pub level: String,
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
    pub position: i64,
    pub started_at: String,
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
    #[serde(rename = "notification")]
    Notification(RuntimeNotificationPayload),
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
    pub runtime_persisted: bool,
    pub raw: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(untagged)]
pub enum AddGameLogEventPayload {
    Compat(String),
    Runtime(RuntimeGameLogEventPayload),
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogPersistenceFallbackPayload {
    pub batch: GameLogWriteBatch,
    pub raw_rows: Vec<Vec<String>>,
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
runtime_event_payload!(RuntimeGameLogEventPayload, "runtimeGameLogEvent");
runtime_event_payload!(GameLogProjection, "gameLogProjection");
runtime_event_payload!(
    GameLogPersistenceFallbackPayload,
    "gameLogPersistenceFallback"
);
runtime_event_payload!(RuntimeWorkerErrorPayload, "runtimeWorkerError");

pub trait RuntimeGameEventBusExt {
    fn emit_game_log_side_effect(&self, event: GameLogSideEffectEvent);
    fn emit_game_client_event(&self, event: GameClientEvent);
    fn emit_runtime_game_log_event(&self, payload: RuntimeGameLogEventPayload);
    fn emit_game_log_projection(&self, projection: GameLogProjection);
    fn emit_game_log_persistence_fallback(&self, payload: GameLogPersistenceFallbackPayload);
    fn emit_runtime_worker_error(&self, payload: RuntimeWorkerErrorPayload);
}

impl RuntimeGameEventBusExt for RuntimeEventBus {
    fn emit_game_log_side_effect(&self, event: GameLogSideEffectEvent) {
        self.emit(event);
    }

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
        // Compatibility event name. This is telemetry-only; the WebView must not
        // write the batch as a fallback for runtime-originated GameLog events.
        self.emit(payload);
    }

    fn emit_runtime_worker_error(&self, payload: RuntimeWorkerErrorPayload) {
        self.emit(payload);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        CrashRelaunchDecisionPayload, EmptyEventPayload, GameClientEvent, GameLogSideEffectEvent,
        NowPlayingPayload,
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
                    position: 42,
                    started_at: "start".into(),
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
                    position: 42,
                    started_at: "start".into(),
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
}
