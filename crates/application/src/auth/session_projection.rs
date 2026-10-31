use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_core::{
    BackgroundCapabilitySession, BackgroundCapabilitySessionIdentity, CurrentUserSnapshot,
    RuntimeAuthScope, RuntimeEventPayload,
};
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;

use super::AuthenticatedRuntimeSession;

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedSessionSnapshot {
    pub auth_scope_generation: u64,
    pub user_id: String,
    pub display_name: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user_snapshot: CurrentUserSnapshot,
}

impl AuthenticatedSessionSnapshot {
    pub fn identity(&self) -> BackgroundCapabilitySessionIdentity {
        BackgroundCapabilitySessionIdentity {
            auth_scope_generation: self.auth_scope_generation,
            current_user_id: self.user_id.clone(),
            endpoint: self.endpoint.clone(),
            websocket: self.websocket.clone(),
        }
    }

    pub fn background_session(&self) -> BackgroundCapabilitySession {
        BackgroundCapabilitySession {
            auth_scope_generation: self.auth_scope_generation,
            current_user_id: self.user_id.clone(),
            endpoint: self.endpoint.clone(),
            websocket: self.websocket.clone(),
            current_user_snapshot: self.current_user_snapshot.clone(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedSessionProjection {
    pub revision: u64,
    pub session: Option<AuthenticatedSessionSnapshot>,
}

impl RuntimeEventPayload for AuthenticatedSessionProjection {
    const EVENT_NAME: &'static str = "authenticatedSessionProjection";
}

pub fn establish_authenticated_session_projection(
    current: &AuthenticatedSessionProjection,
    session: &AuthenticatedRuntimeSession,
    auth_scope_generation: u64,
) -> AuthenticatedSessionProjection {
    AuthenticatedSessionProjection {
        revision: current.revision.saturating_add(1),
        session: Some(AuthenticatedSessionSnapshot {
            auth_scope_generation,
            user_id: session.user_id.clone(),
            display_name: session.display_name.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: CurrentUserSnapshot::from_value(
                session.current_user.as_value().clone(),
            ),
        }),
    }
}

pub fn clear_authenticated_session_projection(
    current: &AuthenticatedSessionProjection,
) -> AuthenticatedSessionProjection {
    AuthenticatedSessionProjection {
        revision: current.revision.saturating_add(1),
        session: None,
    }
}

pub fn replace_authenticated_session_user_if_session_matches(
    session_slot: &Mutex<AuthenticatedSessionProjection>,
    auth_scope: &RuntimeAuthScope,
    expected: &BackgroundCapabilitySessionIdentity,
    snapshot: Value,
) -> bool {
    let mut slot = lock_session_slot(session_slot);
    let Some(session) = slot
        .session
        .as_mut()
        .filter(|session| session.identity() == *expected)
    else {
        return false;
    };
    session.current_user_snapshot = CurrentUserSnapshot::from_value(snapshot);
    let display_name = session.current_user_snapshot.display_name();
    if !display_name.is_empty() {
        session.display_name = display_name.to_string();
        auth_scope.rename_current_user(expected.auth_scope_generation, display_name);
    }
    slot.revision = slot.revision.saturating_add(1);
    true
}

pub fn background_capability_session(
    session_slot: &Mutex<AuthenticatedSessionProjection>,
) -> Option<BackgroundCapabilitySession> {
    lock_session_slot(session_slot)
        .session
        .as_ref()
        .map(AuthenticatedSessionSnapshot::background_session)
}

pub fn background_capability_session_identity(
    session_slot: &Mutex<AuthenticatedSessionProjection>,
) -> Option<BackgroundCapabilitySessionIdentity> {
    lock_session_slot(session_slot)
        .session
        .as_ref()
        .map(AuthenticatedSessionSnapshot::identity)
}

pub fn background_capability_session_scope_key(
    session_slot: &Mutex<AuthenticatedSessionProjection>,
) -> Option<String> {
    background_capability_session_identity(session_slot).map(|session| {
        format!(
            "{}:{}:{}",
            session.auth_scope_generation,
            session.current_user_id,
            normalize_vrchat_api_endpoint(Some(&session.endpoint))
        )
    })
}

pub fn background_capability_session_matches(
    session_slot: &Mutex<AuthenticatedSessionProjection>,
    expected: &BackgroundCapabilitySessionIdentity,
) -> bool {
    lock_session_slot(session_slot)
        .session
        .as_ref()
        .is_some_and(|current| current.identity() == *expected)
}

fn lock_session_slot(
    session_slot: &Mutex<AuthenticatedSessionProjection>,
) -> std::sync::MutexGuard<'_, AuthenticatedSessionProjection> {
    session_slot
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use serde_json::json;

    fn session() -> AuthenticatedRuntimeSession {
        AuthenticatedRuntimeSession::from_user(
            json!({
                "id": "usr_owner",
                "displayName": "Projected User",
                "username": "projected_user",
            }),
            "https://api.example.test/api/1/".into(),
            "wss://pipeline.example.test/".into(),
        )
    }

    fn identity(auth_scope_generation: u64) -> BackgroundCapabilitySessionIdentity {
        BackgroundCapabilitySessionIdentity {
            auth_scope_generation,
            current_user_id: "usr_owner".into(),
            endpoint: "https://api.example.test/api/1".into(),
            websocket: "wss://pipeline.example.test".into(),
        }
    }

    #[test]
    fn establishing_projection_preserves_the_authenticated_session_contract() {
        let projection = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            7,
        );

        assert_eq!(projection.revision, 1);
        let projected_session = projection.session.expect("authenticated session");
        assert_eq!(projected_session.auth_scope_generation, 7);
        assert_eq!(projected_session.user_id, "usr_owner");
        assert_eq!(projected_session.display_name, "Projected User");
        assert_eq!(projected_session.endpoint, "https://api.example.test/api/1");
        assert_eq!(projected_session.websocket, "wss://pipeline.example.test");
        assert_eq!(
            projected_session.current_user_snapshot.as_value()["id"],
            "usr_owner"
        );
    }

    #[test]
    fn clearing_projection_advances_revision_and_removes_the_session() {
        let established = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            7,
        );

        let cleared = clear_authenticated_session_projection(&established);

        assert_eq!(cleared.revision, 2);
        assert!(cleared.session.is_none());
    }

    #[test]
    fn current_user_replacement_renames_the_projection_and_auth_identity() {
        let auth_scope = RuntimeAuthScope::new();
        let scope = auth_scope.set_identity(
            "usr_owner",
            "Projected User",
            "https://api.example.test/api/1",
        );
        let established = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            scope.generation,
        );
        let slot = Arc::new(Mutex::new(established));
        assert!(replace_authenticated_session_user_if_session_matches(
            &slot,
            &auth_scope,
            &identity(scope.generation),
            json!({ "id": "usr_owner", "displayName": "Updated User" }),
        ));

        let projection = slot.lock().unwrap().clone();
        assert_eq!(projection.revision, 2);
        assert_eq!(projection.session.unwrap().display_name, "Updated User");
        assert_eq!(auth_scope.identity().display_name, "Updated User");
        assert_eq!(auth_scope.snapshot().generation, scope.generation);
    }

    #[test]
    fn current_user_replacement_rejects_a_previous_login_generation() {
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set_identity(
            "usr_owner",
            "Projected User",
            "https://api.example.test/api/1",
        );
        let established = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            8,
        );
        let slot = Arc::new(Mutex::new(established));
        assert!(!replace_authenticated_session_user_if_session_matches(
            &slot,
            &auth_scope,
            &identity(7),
            json!({ "id": "usr_owner", "displayName": "Stale User" }),
        ));
        assert_eq!(slot.lock().unwrap().revision, 1);
        assert_eq!(auth_scope.identity().display_name, "Projected User");
    }

    #[test]
    fn background_session_identity_matches_only_the_projected_session() {
        let established = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            7,
        );
        let slot = Mutex::new(established);

        assert_eq!(
            background_capability_session_identity(&slot),
            Some(identity(7))
        );
        assert!(background_capability_session_matches(&slot, &identity(7)));
        assert!(!background_capability_session_matches(&slot, &identity(8)));
        assert_eq!(
            background_capability_session_scope_key(&slot).as_deref(),
            Some("7:usr_owner:https://api.example.test/api/1")
        );
    }
}
