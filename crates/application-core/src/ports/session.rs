use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use vrcx_0_core::realtime::RealtimeSessionContext;

use super::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::BackendRuntimeStatusPublisher;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GameProcessStatus {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub changed_at: String,
}

#[derive(Clone, Debug, Default)]
pub struct BackgroundCapabilitySession {
    pub auth_scope_generation: u64,
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user_snapshot: CurrentUserSnapshot,
}

#[derive(Clone, Debug, specta::Type)]
#[specta(transparent)]
pub struct CurrentUserSnapshot(Arc<Value>);

impl CurrentUserSnapshot {
    pub fn from_value(value: Value) -> Self {
        Self(Arc::new(value))
    }

    pub fn as_value(&self) -> &Value {
        self.0.as_ref()
    }

    pub fn id(&self) -> &str {
        self.string_field("id")
    }

    pub fn display_name(&self) -> &str {
        let display_name = self.string_field("displayName");
        if display_name.is_empty() {
            self.string_field("username")
        } else {
            display_name
        }
    }

    pub fn location(&self) -> &str {
        self.string_field(vrcx_0_core::derived_keys::LOCATION_TAG)
    }

    pub fn raw_location(&self) -> &str {
        self.string_field("location")
    }

    pub fn world_id(&self) -> &str {
        self.string_field("worldId")
    }

    pub fn with_fallback_id(&self, current_user_id: &str) -> Self {
        let current_user_id = current_user_id.trim();
        if current_user_id.is_empty() || !self.id().is_empty() || !self.as_value().is_object() {
            return self.clone();
        }
        let mut value = self.as_value().clone();
        value
            .as_object_mut()
            .expect("current user snapshot was checked as an object")
            .insert("id".into(), Value::String(current_user_id.to_string()));
        Self::from_value(value)
    }

    pub fn shares_storage_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    fn string_field(&self, key: &str) -> &str {
        self.as_value()
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
    }
}

impl Default for CurrentUserSnapshot {
    fn default() -> Self {
        Self::from_value(Value::Null)
    }
}

impl Serialize for CurrentUserSnapshot {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.as_value().serialize(serializer)
    }
}

impl From<Value> for CurrentUserSnapshot {
    fn from(value: Value) -> Self {
        Self::from_value(value)
    }
}

impl From<Arc<Value>> for CurrentUserSnapshot {
    fn from(value: Arc<Value>) -> Self {
        Self(value)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BackgroundCapabilitySessionIdentity {
    pub auth_scope_generation: u64,
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
}

impl BackgroundCapabilitySessionIdentity {
    pub fn matches_auth_scope(&self, auth_scope: &crate::RuntimeAuthScopeSnapshot) -> bool {
        auth_scope.active
            && self.auth_scope_generation == auth_scope.generation
            && self.current_user_id == auth_scope.current_user_id
            && vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint(Some(&self.endpoint))
                == auth_scope.endpoint
    }
}

impl BackgroundCapabilitySession {
    pub fn identity(&self) -> BackgroundCapabilitySessionIdentity {
        BackgroundCapabilitySessionIdentity {
            auth_scope_generation: self.auth_scope_generation,
            current_user_id: self.current_user_id.clone(),
            endpoint: self.endpoint.clone(),
            websocket: self.websocket.clone(),
        }
    }
}

#[cfg(test)]
mod background_capability_session_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identity_is_independent_of_the_current_user_snapshot() {
        let first = BackgroundCapabilitySession {
            auth_scope_generation: 7,
            current_user_id: "usr_owner".into(),
            endpoint: "https://api.example.test/api/1".into(),
            websocket: "wss://pipeline.example.test".into(),
            current_user_snapshot: json!({"large": [1, 2, 3]}).into(),
        };
        let second = BackgroundCapabilitySession {
            current_user_snapshot: json!({"different": true}).into(),
            ..first.clone()
        };

        assert_eq!(first.identity(), second.identity());
    }

    #[test]
    fn identity_matches_only_the_active_auth_scope_generation() {
        let identity = BackgroundCapabilitySessionIdentity {
            auth_scope_generation: 3,
            current_user_id: "usr_owner".into(),
            endpoint: "https://api.example.test/api/1/".into(),
            websocket: "wss://pipeline.example.test".into(),
        };
        let auth_scope = crate::RuntimeAuthScopeSnapshot {
            current_user_id: "usr_owner".into(),
            endpoint: "https://api.example.test/api/1".into(),
            generation: 3,
            active: true,
        };

        assert!(identity.matches_auth_scope(&auth_scope));
        assert!(
            !identity.matches_auth_scope(&crate::RuntimeAuthScopeSnapshot {
                generation: 4,
                ..auth_scope.clone()
            })
        );
        assert!(
            !identity.matches_auth_scope(&crate::RuntimeAuthScopeSnapshot {
                active: false,
                ..auth_scope
            })
        );
    }

    #[test]
    fn cloning_a_capability_session_shares_the_current_user_snapshot() {
        let first = BackgroundCapabilitySession {
            current_user_snapshot: json!({"large": [1, 2, 3]}).into(),
            ..BackgroundCapabilitySession::default()
        };
        let second = first.clone();

        assert!(first
            .current_user_snapshot
            .shares_storage_with(&second.current_user_snapshot));
    }

    #[test]
    fn current_user_snapshot_preserves_raw_json_while_exposing_typed_facts() {
        let snapshot = CurrentUserSnapshot::from_value(json!({
            "id": "usr_owner",
            "displayName": "Owner",
            "location": "wrld_test:1",
            "unknownFutureField": { "nested": true }
        }));

        assert_eq!(snapshot.id(), "usr_owner");
        assert_eq!(snapshot.display_name(), "Owner");
        assert_eq!(snapshot.raw_location(), "wrld_test:1");
        assert_eq!(
            serde_json::to_value(&snapshot).unwrap()["unknownFutureField"]["nested"],
            true
        );
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HostSessionSnapshot {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub is_hmd_afk: bool,
    pub last_game_started_at: Option<String>,
    pub last_game_state_changed_at: Option<String>,
    pub generation: u64,
    pub realtime_generation: u64,
    pub realtime_context: Option<RealtimeSessionContext>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostSessionProjection {
    pub is_game_running: bool,
    #[serde(rename = "isSteamVRRunning")]
    pub is_steamvr_running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_game_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_game_state_changed_at: Option<String>,
    pub generation: u64,
    pub game_changed: bool,
    pub steamvr_changed: bool,
    pub changed_at: String,
}

#[derive(Clone, Debug, Default)]
pub struct HostSessionRuntime {
    state: Arc<Mutex<HostSessionSnapshot>>,
}

impl HostSessionRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply_game_process_status(&self, status: GameProcessStatus) -> HostSessionProjection {
        let mut state = self.lock_state();
        let game_changed = state.is_game_running != status.is_game_running;
        let steamvr_changed = state.is_steamvr_running != status.is_steamvr_running;
        if game_changed || steamvr_changed {
            state.generation = state.generation.saturating_add(1);
            state.last_game_state_changed_at = Some(status.changed_at.clone());
        }
        if game_changed && status.is_game_running {
            state.last_game_started_at = Some(status.changed_at.clone());
        }
        state.is_game_running = status.is_game_running;
        state.is_steamvr_running = status.is_steamvr_running;
        state.is_hmd_afk &= status.is_steamvr_running;

        HostSessionProjection {
            is_game_running: state.is_game_running,
            is_steamvr_running: state.is_steamvr_running,
            last_game_started_at: state.last_game_started_at.clone(),
            last_game_state_changed_at: state.last_game_state_changed_at.clone(),
            generation: state.generation,
            game_changed,
            steamvr_changed,
            changed_at: status.changed_at,
        }
    }

    pub fn set_hmd_afk(&self, is_hmd_afk: bool) {
        self.lock_state().is_hmd_afk = is_hmd_afk;
    }

    pub fn snapshot(&self) -> HostSessionSnapshot {
        self.lock_state().clone()
    }

    pub fn projection_snapshot(&self) -> HostSessionProjection {
        let state = self.lock_state();
        HostSessionProjection {
            is_game_running: state.is_game_running,
            is_steamvr_running: state.is_steamvr_running,
            last_game_started_at: state.last_game_started_at.clone(),
            last_game_state_changed_at: state.last_game_state_changed_at.clone(),
            generation: state.generation,
            game_changed: false,
            steamvr_changed: false,
            changed_at: state.last_game_state_changed_at.clone().unwrap_or_default(),
        }
    }

    pub fn set_realtime_context(&self, context: RealtimeSessionContext) -> u64 {
        let mut state = self.lock_state();
        state.realtime_generation = state.realtime_generation.saturating_add(1);
        state.realtime_context = Some(context);
        state.realtime_generation
    }

    pub fn clear_realtime_context(&self) -> u64 {
        let mut state = self.lock_state();
        state.realtime_generation = state.realtime_generation.saturating_add(1);
        state.realtime_context = None;
        state.realtime_generation
    }

    pub fn clear_realtime_context_if_generation(&self, generation: u64) -> bool {
        let mut state = self.lock_state();
        if state.realtime_generation != generation {
            return false;
        }
        state.realtime_generation = state.realtime_generation.saturating_add(1);
        state.realtime_context = None;
        true
    }

    pub fn is_realtime_generation_active(&self, generation: u64) -> bool {
        let state = self.lock_state();
        state.realtime_generation == generation && state.realtime_context.is_some()
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, HostSessionSnapshot> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[derive(Clone)]
pub struct SessionHostRuntime {
    session: HostSessionRuntime,
    backend_status: BackendRuntimeStatusPublisher,
}

impl SessionHostRuntime {
    pub fn new(session: HostSessionRuntime, backend_status: BackendRuntimeStatusPublisher) -> Self {
        Self {
            session,
            backend_status,
        }
    }
}

impl GameProcessEventSink for SessionHostRuntime {
    fn on_game_process_event(&self, event: GameProcessEvent) -> crate::Result<()> {
        let projection = self.session.apply_game_process_status(GameProcessStatus {
            is_game_running: event.is_game_running,
            is_steamvr_running: event.is_steamvr_running,
            changed_at: chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
        });

        if projection.game_changed || projection.steamvr_changed {
            self.backend_status.publish_game_process_status(projection);
        }

        Ok(())
    }
}
