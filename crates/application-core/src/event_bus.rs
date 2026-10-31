use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_contracts::{runtime_event_payload, RuntimeEventPayload};

use crate::backend_runtime::{BackendRuntimeTelemetry, RealtimeProjectionSync};
use crate::events::{
    FriendProfileLoadStatusPayload, FriendProjection, PrintAutoCleanupEvent,
    RealtimeCurrentUserProjection, RealtimeEconomyBalancePayload, RealtimeEntryCorrection,
    RealtimeInstanceClosedProjection, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection, RealtimeUserProjection,
};
use crate::ports::HostSessionProjection;
use crate::{FavoriteChangeScope, FavoriteEntityKind, RuntimeAuthScopeSnapshot};
use vrcx_0_core::json::RawJson;
use vrcx_0_core::OwnerId;

pub trait RuntimeEventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoritesChangedPayload {
    pub owner_user_id: OwnerId,
    pub endpoint: String,
    pub kind: FavoriteChangeScope,
    pub local: bool,
    pub remote: bool,
    pub changes: Vec<FavoriteChange>,
    pub requires_refresh: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FavoriteChange {
    LocalAdded {
        kind: FavoriteEntityKind,
        #[serde(rename = "entityId")]
        entity_id: String,
        #[serde(rename = "groupName")]
        group_name: String,
    },
    LocalRemoved {
        kind: FavoriteEntityKind,
        #[serde(rename = "entityId")]
        entity_id: String,
        #[serde(rename = "groupName")]
        group_name: String,
    },
    LocalGroupCreated {
        kind: FavoriteEntityKind,
        #[serde(rename = "groupName")]
        group_name: String,
    },
    LocalGroupRenamed {
        kind: FavoriteEntityKind,
        #[serde(rename = "groupName")]
        group_name: String,
        #[serde(rename = "newGroupName")]
        new_group_name: String,
    },
    LocalGroupDeleted {
        kind: FavoriteEntityKind,
        #[serde(rename = "groupName")]
        group_name: String,
    },
    RemoteAdded {
        favorite: RawJson,
    },
    RemoteRemoved {
        #[serde(rename = "objectId")]
        object_id: String,
    },
}

impl FavoritesChangedPayload {
    pub fn invalidated(
        scope: &RuntimeAuthScopeSnapshot,
        kind: FavoriteChangeScope,
        local: bool,
        remote: bool,
    ) -> Self {
        Self::from_changes(scope, kind, local, remote, Vec::new())
    }

    pub fn from_changes(
        scope: &RuntimeAuthScopeSnapshot,
        kind: FavoriteChangeScope,
        local: bool,
        remote: bool,
        changes: Vec<FavoriteChange>,
    ) -> Self {
        let requires_refresh = changes.is_empty();
        Self {
            owner_user_id: OwnerId::new(scope.current_user_id.clone()),
            endpoint: scope.endpoint.clone(),
            kind,
            local,
            remote,
            changes,
            requires_refresh,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrcStatusSnapshot {
    pub status: String,
    pub indicator: String,
    pub summary: String,
    pub updated_at: Option<String>,
    pub last_fetched_at: Option<String>,
    pub polling_interval_ms: u32,
    pub refreshing: bool,
    pub error: String,
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
    pub owner_user_id: OwnerId,
    pub endpoint: String,
    pub path: String,
    pub reason: String,
    pub status_code: i32,
    pub auth_scope_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub realtime_transport: Option<RuntimeRealtimeTransportEpoch>,
}

runtime_event_payload!(FavoritesChangedPayload, "favoritesChanged");
runtime_event_payload!(VrcStatusSnapshot, "vrcStatus");
runtime_event_payload!(RuntimeVrchatAuthFailurePayload, "runtimeVrchatAuthFailure");
runtime_event_payload!(BackendRuntimeTelemetry, "backendRuntimeTelemetry");
runtime_event_payload!(RealtimeProjectionSync, "realtimeProjectionSync");
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
runtime_event_payload!(RealtimeEconomyBalancePayload, "realtimeEconomyBalance");
runtime_event_payload!(FriendProfileLoadStatusPayload, "friendProfileLoadStatus");

#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone, Debug)]
pub struct RuntimeEventForTest {
    pub name: String,
    pub payload: RawJson,
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
        match serde_json::to_value(&payload) {
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
                payload: payload.clone().into(),
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
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{FavoriteChange, FavoritesChangedPayload, RuntimeEventBus};
    use crate::{FavoriteChangeScope, FavoriteEntityKind, RuntimeAuthScopeSnapshot};

    #[test]
    fn favorite_delta_preserves_scope_and_camel_case_wire_shape() {
        let bus = RuntimeEventBus::new();
        let scope = RuntimeAuthScopeSnapshot {
            current_user_id: "usr_self".into(),
            endpoint: "https://api.vrchat.cloud/api/1".into(),
            generation: 7,
            active: true,
        };

        bus.emit(FavoritesChangedPayload::from_changes(
            &scope,
            FavoriteChangeScope::Friend,
            true,
            false,
            vec![FavoriteChange::LocalAdded {
                kind: FavoriteEntityKind::Friend,
                entity_id: "usr_friend".into(),
                group_name: "Close".into(),
            }],
        ));

        let events = bus.take_events_for_test();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "favoritesChanged");
        assert_eq!(
            events[0].payload,
            json!({
                "ownerUserId": "usr_self",
                "endpoint": "https://api.vrchat.cloud/api/1",
                "kind": "friend",
                "local": true,
                "remote": false,
                "changes": [{
                    "type": "localAdded",
                    "kind": "friend",
                    "entityId": "usr_friend",
                    "groupName": "Close"
                }],
                "requiresRefresh": false
            })
            .into()
        );
    }
}
