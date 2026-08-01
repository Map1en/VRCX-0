use crate::notification::{
    auth_webhook_should_recover, send_auth_webhook, AuthWebhookEvent, AuthWebhookEventKind,
};

use super::{
    normalize_vrchat_api_endpoint, AtomicFlagGuard, AuthenticatedRuntimeSession,
    BackendRuntimeMode, BackendRuntimeSnapshot, NonInteractiveAuthError, RuntimeHostState,
};
use vrcx_0_core::time::now_iso;

#[cfg(test)]
use super::BackendRuntimePhase;

#[derive(Clone, Debug)]
struct BackgroundAuthRecoveryContext {
    user_id: String,
    display_name: String,
    endpoint: String,
    reason: String,
    mode: String,
    timestamp: String,
}

impl RuntimeHostState {
    pub async fn recover_background_auth_after_failure(
        &self,
        reason: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        let snapshot = self.backend_runtime.snapshot();
        if !auth_webhook_should_recover(&snapshot) {
            return snapshot;
        }
        let Some(_guard) = AtomicFlagGuard::try_acquire(&self.background_auth_recovery_running)
        else {
            return snapshot;
        };

        let snapshot = self.backend_runtime.snapshot();
        if !auth_webhook_should_recover(&snapshot) {
            return snapshot;
        }

        let context = BackgroundAuthRecoveryContext::from_snapshot(
            &snapshot,
            self.background_auth_recovery_endpoint(&snapshot),
            reason.into(),
        );
        self.emit_backend_runtime_telemetry_snapshot(
            "authRecoveryStarted",
            context.reason.clone(),
            snapshot,
        );
        self.clear_backend_frontend_session();
        self.backend_runtime.set_authenticating();

        match self
            .authenticate_non_interactive_for_saved_user(&context.user_id, &context.endpoint)
            .await
        {
            Ok(session) => {
                if !context.matches_session(&session) {
                    let reason = "Recovered session does not match dropped background auth scope."
                        .to_string();
                    let snapshot = self.backend_runtime.set_auth_error(reason.clone());
                    self.emit_backend_runtime_telemetry_snapshot(
                        "authRecoveryFailed",
                        reason.clone(),
                        snapshot.clone(),
                    );
                    self.send_background_auth_recovery_webhook(&context.failed_event(reason))
                        .await;
                    return snapshot;
                }
                match self.start_authenticated_runtime_session(session) {
                    Ok(snapshot) => snapshot,
                    Err(error) => {
                        let reason = error.to_string();
                        let snapshot = self.backend_runtime.set_auth_error(reason.clone());
                        self.emit_backend_runtime_telemetry_snapshot(
                            "authRecoveryFailed",
                            reason.clone(),
                            snapshot.clone(),
                        );
                        self.send_background_auth_recovery_webhook(&context.failed_event(reason))
                            .await;
                        snapshot
                    }
                }
            }
            Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                let snapshot = self
                    .backend_runtime
                    .set_auth_interaction_required(reason.clone());
                self.emit_backend_runtime_telemetry_snapshot(
                    "authRecoveryFailed",
                    reason.clone(),
                    snapshot.clone(),
                );
                self.send_background_auth_recovery_webhook(&context.failed_event(reason))
                    .await;
                snapshot
            }
            Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason }) => {
                let snapshot = self.clear_invalid_non_interactive_auth_session(&user_id, &reason);
                self.emit_backend_runtime_telemetry_snapshot(
                    "authRecoveryFailed",
                    reason.clone(),
                    snapshot.clone(),
                );
                self.send_background_auth_recovery_webhook(&context.failed_event(reason))
                    .await;
                snapshot
            }
            Err(NonInteractiveAuthError::Failed(reason)) => {
                let snapshot = self.backend_runtime.set_auth_error(reason.clone());
                self.emit_backend_runtime_telemetry_snapshot(
                    "authRecoveryFailed",
                    reason.clone(),
                    snapshot.clone(),
                );
                self.send_background_auth_recovery_webhook(&context.failed_event(reason))
                    .await;
                snapshot
            }
        }
    }

    async fn send_background_auth_recovery_webhook(&self, event: &AuthWebhookEvent) {
        send_auth_webhook(
            self.runtime_context.config(),
            self.web.as_ref(),
            &self.runtime_context.diagnostics,
            event,
        )
        .await;
    }

    fn background_auth_recovery_endpoint(&self, snapshot: &BackendRuntimeSnapshot) -> String {
        let user_id = snapshot.auth_user_id.trim();
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        if auth_scope.active && auth_scope.current_user_id == user_id {
            return auth_scope.endpoint;
        }
        self.backend_runtime_frontend_session_snapshot()
            .filter(|session| session.user_id.trim() == user_id)
            .map(|session| session.endpoint)
            .unwrap_or_default()
    }
}

impl BackgroundAuthRecoveryContext {
    fn from_snapshot(snapshot: &BackendRuntimeSnapshot, endpoint: String, reason: String) -> Self {
        Self {
            user_id: snapshot.auth_user_id.trim().to_string(),
            display_name: snapshot.auth_display_name.trim().to_string(),
            endpoint: normalize_vrchat_api_endpoint(Some(&endpoint)),
            reason: normalize_recovery_reason(reason),
            mode: backend_mode_label(snapshot.mode).into(),
            timestamp: now_iso(),
        }
    }

    fn matches_session(&self, session: &AuthenticatedRuntimeSession) -> bool {
        self.user_id == session.user_id.trim()
            && self.endpoint == normalize_vrchat_api_endpoint(Some(&session.endpoint))
    }

    fn failed_event(&self, reason: String) -> AuthWebhookEvent {
        AuthWebhookEvent {
            kind: AuthWebhookEventKind::ReloginFailed,
            user_id: self.user_id.clone(),
            display_name: self.display_name.clone(),
            reason: normalize_recovery_reason(reason),
            mode: self.mode.clone(),
            timestamp: self.timestamp.clone(),
        }
    }
}

fn normalize_recovery_reason(reason: String) -> String {
    let reason = reason.trim();
    if reason.is_empty() {
        "Background realtime auth failed.".into()
    } else {
        reason.into()
    }
}

fn backend_mode_label(mode: BackendRuntimeMode) -> &'static str {
    match mode {
        BackendRuntimeMode::Foreground => "foreground",
        BackendRuntimeMode::Background => "background",
        BackendRuntimeMode::Headless => "headless",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn recovery_context_matches_only_dropped_user_and_endpoint() {
        let context = BackgroundAuthRecoveryContext::from_snapshot(
            &snapshot("usr_before"),
            "https://api.example.test/api/1/".into(),
            "auth failed".into(),
        );

        assert!(context.matches_session(&session("usr_before", "https://api.example.test/api/1")));
        assert!(!context.matches_session(&session("usr_after", "https://api.example.test/api/1")));
        assert!(!context.matches_session(&session("usr_before", "https://api.other.test/api/1")));
    }

    fn snapshot(user_id: &str) -> BackendRuntimeSnapshot {
        BackendRuntimeSnapshot {
            mode: BackendRuntimeMode::Background,
            phase: BackendRuntimePhase::Running,
            auth_status: "authenticated".into(),
            auth_user_id: user_id.into(),
            auth_display_name: "Pizza".into(),
            ws_status: "authFailure".into(),
            game_log_status: "idle".into(),
            process_status: "unknown".into(),
            ws_message_counts: BTreeMap::new(),
            ws_persisted_count: 0,
            game_log_persisted_count: 0,
            last_error: None,
            updated_at: "2026-07-03T08:30:00.000Z".into(),
            friend_profile_load: vrcx_0_application_core::FriendProfileLoadStatusPayload::default(),
        }
    }

    fn session(user_id: &str, endpoint: &str) -> AuthenticatedRuntimeSession {
        AuthenticatedRuntimeSession::from_user(
            json!({
                "id": user_id,
                "displayName": "Pizza"
            }),
            endpoint.into(),
            "wss://pipeline.vrchat.cloud".into(),
        )
    }
}
