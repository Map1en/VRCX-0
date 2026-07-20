use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::backend_runtime::BackendRuntimeTelemetry;
use crate::events::{
    FriendProfileLoadStatusPayload, FriendProjection, PrintAutoCleanupEvent,
    RealtimeCurrentUserProjection, RealtimeEntryCorrection, RealtimeInstanceClosedProjection,
    RealtimeInstanceQueueProjection, RealtimeNotificationProjection, RealtimeUserProjection,
};
use crate::ports::HostSessionProjection;
use vrcx_0_core::realtime::RealtimeWsStatusPayload;

pub trait RuntimeEventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

pub trait RuntimeEventPayload: Serialize + specta::Type {
    const EVENT_NAME: &'static str;
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoritesChangedPayload {
    pub kind: String,
    pub local: bool,
    pub remote: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRealtimeTransportEpoch {
    pub client_run_id: u64,
    pub generation: u64,
    pub session_generation: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVrchatAuthFailurePayload {
    pub owner_user_id: String,
    pub endpoint: String,
    pub path: String,
    pub reason: String,
    pub status_code: i32,
    pub auth_scope_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub realtime_transport: Option<RuntimeRealtimeTransportEpoch>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct BackendRuntimeCountTelemetry {
    kind: String,
    count: u64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct BackendRuntimeMessageTelemetry {
    kind: String,
    message_type: String,
}

macro_rules! runtime_event_payload {
    ($payload:ty, $event:literal) => {
        impl RuntimeEventPayload for $payload {
            const EVENT_NAME: &'static str = $event;
        }
    };
}

runtime_event_payload!(FavoritesChangedPayload, "favoritesChanged");
runtime_event_payload!(RuntimeVrchatAuthFailurePayload, "runtimeVrchatAuthFailure");
runtime_event_payload!(BackendRuntimeCountTelemetry, "backendRuntimeTelemetry");
runtime_event_payload!(BackendRuntimeMessageTelemetry, "backendRuntimeTelemetry");
runtime_event_payload!(BackendRuntimeTelemetry, "backendRuntimeTelemetry");
runtime_event_payload!(RealtimeWsStatusPayload, "realtimeWsStatus");
runtime_event_payload!(FriendProjection, "realtimeFriendProjection");
runtime_event_payload!(RealtimeUserProjection, "realtimeUserProjection");
runtime_event_payload!(
    RealtimeNotificationProjection,
    "realtimeNotificationProjection"
);
runtime_event_payload!(RealtimeEntryCorrection, "realtimeEntryCorrection");
runtime_event_payload!(
    RealtimeCurrentUserProjection,
    "realtimeCurrentUserProjection"
);
runtime_event_payload!(
    RealtimeInstanceClosedProjection,
    "realtimeInstanceClosedProjection"
);
runtime_event_payload!(
    RealtimeInstanceQueueProjection,
    "realtimeInstanceQueueProjection"
);
runtime_event_payload!(HostSessionProjection, "updateIsGameRunning");
runtime_event_payload!(PrintAutoCleanupEvent, "printsAutoCleanup");
runtime_event_payload!(FriendProfileLoadStatusPayload, "friendProfileLoadStatus");

#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone, Debug)]
pub struct RuntimeEventForTest {
    pub name: String,
    pub payload: Value,
}

#[derive(Clone, Default)]
pub struct RuntimeEventBus {
    sink: Arc<Mutex<Option<Arc<dyn RuntimeEventSink>>>>,
    #[cfg(any(test, feature = "test-utils"))]
    events: Arc<Mutex<Vec<RuntimeEventForTest>>>,
}

impl RuntimeEventBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_sink<S>(&self, sink: S)
    where
        S: RuntimeEventSink + 'static,
    {
        *self.sink.lock().unwrap() = Some(Arc::new(sink));
    }

    pub fn emit<T: RuntimeEventPayload>(&self, payload: T) {
        let event = T::EVENT_NAME;
        match serde_json::to_value(payload) {
            Ok(value) => self.emit_value(event, value),
            Err(error) => {
                tracing::warn!(event, error = %error, "failed to serialize runtime event payload");
            }
        }
    }

    fn emit_value(&self, event: &str, payload: Value) {
        #[cfg(any(test, feature = "test-utils"))]
        {
            self.events.lock().unwrap().push(RuntimeEventForTest {
                name: event.to_string(),
                payload: payload.clone(),
            });
        }

        let sink = self.sink.lock().unwrap().clone();
        if let Some(sink) = sink {
            sink.emit(event, payload);
        }
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub fn take_events_for_test(&self) -> Vec<RuntimeEventForTest> {
        std::mem::take(&mut *self.events.lock().unwrap())
    }

    pub fn emit_ws_persisted(&self, count: u64) {
        self.emit(BackendRuntimeCountTelemetry {
            kind: "wsPersisted".into(),
            count,
        });
    }

    pub fn emit_game_log_persisted(&self, count: u64) {
        self.emit(BackendRuntimeCountTelemetry {
            kind: "gameLogPersisted".into(),
            count,
        });
    }

    pub fn emit_ws_message_observed(&self, message_type: impl Into<String>) {
        self.emit(BackendRuntimeMessageTelemetry {
            kind: "wsMessage".into(),
            message_type: message_type.into(),
        });
    }

    pub fn emit_realtime_ws_status(&self, payload: RealtimeWsStatusPayload) {
        self.emit(payload);
    }

    pub fn emit_runtime_vrchat_auth_failure(&self, payload: RuntimeVrchatAuthFailurePayload) {
        self.emit(payload);
    }

    pub fn emit_realtime_friend_projection(&self, payload: FriendProjection) {
        self.emit(payload);
    }

    pub fn emit_realtime_user_projection(&self, payload: RealtimeUserProjection) {
        self.emit(payload);
    }

    pub fn emit_realtime_notification_projection(&self, payload: RealtimeNotificationProjection) {
        self.emit(payload);
    }

    pub fn emit_realtime_entry_correction(&self, payload: RealtimeEntryCorrection) {
        self.emit(payload);
    }

    pub fn emit_realtime_current_user_projection(&self, payload: RealtimeCurrentUserProjection) {
        self.emit(payload);
    }

    pub fn emit_realtime_instance_closed_projection(
        &self,
        payload: RealtimeInstanceClosedProjection,
    ) {
        self.emit(payload);
    }

    pub fn emit_realtime_instance_queue_projection(
        &self,
        payload: RealtimeInstanceQueueProjection,
    ) {
        self.emit(payload);
    }

    pub fn emit_game_process_status(&self, payload: HostSessionProjection) {
        self.emit(payload);
    }

    pub fn emit_prints_auto_cleanup(&self, payload: PrintAutoCleanupEvent) {
        self.emit(payload);
    }

    pub fn emit_friend_profile_load_status(&self, payload: FriendProfileLoadStatusPayload) {
        self.emit(payload);
    }

    pub fn emit_favorites_changed(&self, payload: FavoritesChangedPayload) {
        self.emit(payload);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::RuntimeEventBus;

    #[test]
    fn backend_runtime_observations_preserve_event_name_and_wire_shape() {
        let bus = RuntimeEventBus::new();

        bus.emit_ws_persisted(2);
        bus.emit_game_log_persisted(3);
        bus.emit_ws_message_observed("friend-location");

        let events = bus.take_events_for_test();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].name, "backendRuntimeTelemetry");
        assert_eq!(
            events[0].payload,
            json!({ "kind": "wsPersisted", "count": 2 })
        );
        assert_eq!(events[1].name, "backendRuntimeTelemetry");
        assert_eq!(
            events[1].payload,
            json!({ "kind": "gameLogPersisted", "count": 3 })
        );
        assert_eq!(events[2].name, "backendRuntimeTelemetry");
        assert_eq!(
            events[2].payload,
            json!({ "kind": "wsMessage", "messageType": "friend-location" })
        );
    }
}
