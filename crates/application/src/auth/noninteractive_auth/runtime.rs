use futures_util::future::BoxFuture;

use std::sync::Arc;

use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
use vrcx_0_application_core::Result;

use vrcx_0_contracts::vrchat_login::auth_response_error_message;

use super::{
    parse_current_user_response, AuthenticatedRuntimeSession, CookieSessionProbe,
    NonInteractiveAuthError,
};
use crate::auth::{
    LoginSuccessRecordInput, LogoutRecordInput, SavedAuthAutoLoginStatus, SavedAuthSnapshot,
    SavedCredentialLoginStartInput, SavedCredentialSessionData,
};

pub type NonInteractiveAuthProbeFuture<'a> =
    BoxFuture<'a, std::result::Result<CookieSessionProbe, NonInteractiveAuthError>>;
pub type NonInteractiveAuthResponseFuture<'a> = BoxFuture<'a, Result<VrchatApiResponse>>;

pub trait NonInteractiveAuthActions: Send + Sync {
    fn clear_vrchat_config_snapshot(&self);
    fn saved_snapshot(&self) -> Result<SavedAuthSnapshot>;
    fn saved_session_data(&self, user_id: &str) -> Result<Option<SavedCredentialSessionData>>;
    fn probe_current_user<'a>(
        &'a self,
        user_id: String,
        endpoint: String,
        websocket: String,
    ) -> NonInteractiveAuthProbeFuture<'a>;
    fn restore_cookies(&self, cookies: &str) -> Result<()>;
    fn probe_saved_current_user<'a>(
        &'a self,
        user_id: String,
        endpoint: String,
        websocket: String,
    ) -> NonInteractiveAuthProbeFuture<'a>;
    fn start_saved_credential_login<'a>(
        &'a self,
        input: SavedCredentialLoginStartInput,
    ) -> NonInteractiveAuthResponseFuture<'a>;
    fn record_login_success(&self, input: LoginSuccessRecordInput) -> Result<()>;
    fn clear_browser_session(&self);
    fn record_logout(&self, input: LogoutRecordInput) -> Result<()>;
}

#[derive(Clone)]
pub struct NonInteractiveAuthRuntime {
    actions: Arc<dyn NonInteractiveAuthActions>,
}

impl NonInteractiveAuthRuntime {
    pub fn new(actions: Arc<dyn NonInteractiveAuthActions>) -> Self {
        Self { actions }
    }

    pub async fn authenticate_last_saved_user(
        &self,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let snapshot = self
            .actions
            .saved_snapshot()
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        let last_user = snapshot.last_user_logged_in.clone().unwrap_or_default();
        if last_user.is_empty() {
            return Err(NonInteractiveAuthError::Failed(
                "No saved account is available for headless login.".into(),
            ));
        }

        self.authenticate_saved_user_from_snapshot(last_user, None, snapshot)
            .await
    }

    pub async fn authenticate_saved_user(
        &self,
        user_id: &str,
        endpoint: &str,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let user_id = user_id.trim();
        if user_id.is_empty() {
            return Err(NonInteractiveAuthError::Failed(
                "No saved account is available for background login recovery.".into(),
            ));
        }
        let snapshot = self
            .actions
            .saved_snapshot()
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        self.authenticate_saved_user_from_snapshot(
            user_id.to_string(),
            Some(endpoint.to_string()),
            snapshot,
        )
        .await
    }

    async fn authenticate_saved_user_from_snapshot(
        &self,
        user_id: String,
        endpoint_override: Option<String>,
        snapshot: SavedAuthSnapshot,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        self.actions.clear_vrchat_config_snapshot();
        let saved_record = self
            .actions
            .saved_session_data(&user_id)
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        let (saved_endpoint, websocket, saved_cookies) = saved_record.map_or_else(
            || (String::new(), String::new(), None),
            |record| (record.endpoint, record.websocket, record.cookies),
        );
        let endpoint = endpoint_override
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(saved_endpoint);

        match self
            .actions
            .probe_current_user(user_id.clone(), endpoint.clone(), websocket.clone())
            .await
        {
            Ok(CookieSessionProbe::Authenticated(session)) => {
                self.record_login_success(&session)?;
                return Ok(session);
            }
            Ok(CookieSessionProbe::Fallback) => {}
            Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                return Err(NonInteractiveAuthError::InteractionRequired(reason));
            }
            Err(error @ NonInteractiveAuthError::SessionInvalidated { .. }) => {
                return Err(error);
            }
            Err(NonInteractiveAuthError::Failed(reason)) => {
                tracing::warn!(reason, "global cookie auth restore failed");
            }
        }

        if let Some(cookies) = saved_cookies.as_deref() {
            if let Err(error) = self.actions.restore_cookies(cookies) {
                tracing::warn!(error = %error, "failed to restore saved auth cookies");
            } else {
                match self
                    .actions
                    .probe_saved_current_user(user_id.clone(), endpoint.clone(), websocket.clone())
                    .await
                {
                    Ok(CookieSessionProbe::Authenticated(session)) => {
                        self.record_login_success(&session)?;
                        return Ok(session);
                    }
                    Ok(CookieSessionProbe::Fallback) => {}
                    Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                        return Err(NonInteractiveAuthError::InteractionRequired(reason));
                    }
                    Err(error @ NonInteractiveAuthError::SessionInvalidated { .. }) => {
                        return Err(error);
                    }
                    Err(NonInteractiveAuthError::Failed(reason)) => {
                        tracing::warn!(reason, "saved cookie auth restore failed");
                    }
                }
            }
        }

        let fallback_available = snapshot.auto_login_status == SavedAuthAutoLoginStatus::Available
            && snapshot
                .saved_credentials_list
                .iter()
                .any(|credential| credential.user.id == user_id);
        if !fallback_available {
            return Err(NonInteractiveAuthError::Failed(
                "Saved credentials are not available for headless login.".into(),
            ));
        }

        let response = self
            .actions
            .start_saved_credential_login(SavedCredentialLoginStartInput {
                user_id: user_id.clone(),
                endpoint: endpoint.clone(),
            })
            .await
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if matches!(response.status, 401 | 403) {
            return Err(NonInteractiveAuthError::SessionInvalidated {
                user_id,
                status_code: Some(response.status),
                reason: auth_response_error_message(
                    &response,
                    format!(
                        "VRChat config request failed with HTTP {}.",
                        response.status
                    ),
                ),
            });
        }
        let user = parse_current_user_response(response)?;
        let session = AuthenticatedRuntimeSession::from_user(user, endpoint, websocket);
        self.record_login_success(&session)?;
        Ok(session)
    }

    fn record_login_success(
        &self,
        session: &AuthenticatedRuntimeSession,
    ) -> std::result::Result<(), NonInteractiveAuthError> {
        self.actions
            .record_login_success(LoginSuccessRecordInput {
                user: session.current_user.clone(),
                login_params: serde_json::json!({
                    "endpoint": session.endpoint,
                    "websocket": session.websocket,
                })
                .into(),
                stored_login_params: None,
                save_credentials: false,
            })
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))
    }

    pub fn clear_invalid_saved_session(&self, user_id: &str) {
        self.actions.clear_browser_session();
        if user_id.trim().is_empty() {
            return;
        }
        if let Err(error) = self.actions.record_logout(LogoutRecordInput {
            user_id: user_id.trim().to_string(),
            clear_last_user_logged_in: false,
        }) {
            tracing::warn!(
                error = %error,
                user_id = %user_id,
                "failed to clear saved auth after invalid VRChat session"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use serde_json::json;

    use super::*;
    use crate::auth::{SavedCredentialSnapshot, SavedCredentialUser, SavedLoginParamsSnapshot};
    use vrcx_0_contracts::vrchat_api::vrchat_response;

    struct FakeActions {
        snapshot: SavedAuthSnapshot,
        session_data: Option<SavedCredentialSessionData>,
        probes: Mutex<VecDeque<std::result::Result<CookieSessionProbe, NonInteractiveAuthError>>>,
        response: Mutex<Option<Result<VrchatApiResponse>>>,
        events: Mutex<Vec<String>>,
    }

    impl FakeActions {
        fn new(snapshot: SavedAuthSnapshot) -> Self {
            Self {
                snapshot,
                session_data: None,
                probes: Mutex::new(VecDeque::new()),
                response: Mutex::new(None),
                events: Mutex::new(Vec::new()),
            }
        }

        fn available() -> Self {
            let user = SavedCredentialUser {
                id: "usr_owner".into(),
                display_name: Some("Owner".into()),
                username: None,
                icon_url: None,
            };
            Self::new(SavedAuthSnapshot {
                last_user_logged_in: Some(user.id.clone()),
                saved_credentials_list: vec![SavedCredentialSnapshot {
                    user,
                    login_params: SavedLoginParamsSnapshot {
                        username: "owner".into(),
                    },
                    has_login_credentials: true,
                    has_cookies: false,
                }],
                auto_login_delay_enabled: false,
                auto_login_delay_seconds: 0,
                auto_login_status: SavedAuthAutoLoginStatus::Available,
                auto_login_reason: String::new(),
            })
        }

        fn push_probe(
            &self,
            result: std::result::Result<CookieSessionProbe, NonInteractiveAuthError>,
        ) {
            self.probes.lock().unwrap().push_back(result);
        }

        fn event_names(&self) -> Vec<String> {
            self.events.lock().unwrap().clone()
        }
    }

    impl NonInteractiveAuthActions for FakeActions {
        fn clear_vrchat_config_snapshot(&self) {
            self.events.lock().unwrap().push("clear_config".into());
        }

        fn saved_snapshot(&self) -> Result<SavedAuthSnapshot> {
            self.events.lock().unwrap().push("snapshot".into());
            Ok(self.snapshot.clone())
        }

        fn saved_session_data(&self, _user_id: &str) -> Result<Option<SavedCredentialSessionData>> {
            self.events.lock().unwrap().push("session_data".into());
            Ok(self
                .session_data
                .as_ref()
                .map(|data| SavedCredentialSessionData {
                    endpoint: data.endpoint.clone(),
                    websocket: data.websocket.clone(),
                    cookies: data.cookies.clone(),
                }))
        }

        fn probe_current_user<'a>(
            &'a self,
            _user_id: String,
            _endpoint: String,
            _websocket: String,
        ) -> NonInteractiveAuthProbeFuture<'a> {
            self.events.lock().unwrap().push("global_probe".into());
            let result = self.probes.lock().unwrap().pop_front().unwrap();
            Box::pin(async move { result })
        }

        fn restore_cookies(&self, _cookies: &str) -> Result<()> {
            self.events.lock().unwrap().push("restore_cookies".into());
            Ok(())
        }

        fn probe_saved_current_user<'a>(
            &'a self,
            _user_id: String,
            _endpoint: String,
            _websocket: String,
        ) -> NonInteractiveAuthProbeFuture<'a> {
            self.events.lock().unwrap().push("saved_probe".into());
            let result = self.probes.lock().unwrap().pop_front().unwrap();
            Box::pin(async move { result })
        }

        fn start_saved_credential_login<'a>(
            &'a self,
            _input: SavedCredentialLoginStartInput,
        ) -> NonInteractiveAuthResponseFuture<'a> {
            self.events.lock().unwrap().push("credential_login".into());
            let result = self.response.lock().unwrap().take().unwrap();
            Box::pin(async move { result })
        }

        fn record_login_success(&self, input: LoginSuccessRecordInput) -> Result<()> {
            assert!(!input.save_credentials);
            self.events.lock().unwrap().push("record_success".into());
            Ok(())
        }

        fn clear_browser_session(&self) {
            self.events.lock().unwrap().push("clear_browser".into());
        }

        fn record_logout(&self, input: LogoutRecordInput) -> Result<()> {
            assert!(!input.clear_last_user_logged_in);
            self.events.lock().unwrap().push("record_logout".into());
            Ok(())
        }
    }

    fn authenticated_session() -> AuthenticatedRuntimeSession {
        AuthenticatedRuntimeSession::from_user(
            json!({"id": "usr_owner", "displayName": "Owner"}),
            "https://api.example.test/api/1".into(),
            "wss://pipeline.example.test".into(),
        )
    }

    #[tokio::test]
    async fn global_cookie_success_stops_the_fallback_chain_and_records_the_login() {
        let actions = Arc::new(FakeActions::available());
        actions.push_probe(Ok(CookieSessionProbe::Authenticated(
            authenticated_session(),
        )));
        let runtime = NonInteractiveAuthRuntime::new(actions.clone());

        let session = runtime.authenticate_last_saved_user().await.unwrap();

        assert_eq!(session.user_id, "usr_owner");
        assert_eq!(
            actions.event_names(),
            [
                "snapshot",
                "clear_config",
                "session_data",
                "global_probe",
                "record_success"
            ]
        );
    }

    #[tokio::test]
    async fn saved_cookie_interaction_requirement_stops_before_password_fallback() {
        let mut fake = FakeActions::available();
        fake.session_data = Some(SavedCredentialSessionData {
            endpoint: "https://api.example.test".into(),
            websocket: String::new(),
            cookies: Some("auth=1".into()),
        });
        let actions = Arc::new(fake);
        actions.push_probe(Ok(CookieSessionProbe::Fallback));
        actions.push_probe(Err(NonInteractiveAuthError::InteractionRequired(
            "2fa".into(),
        )));
        let runtime = NonInteractiveAuthRuntime::new(actions.clone());

        let result = runtime.authenticate_last_saved_user().await;

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::InteractionRequired(reason)) if reason == "2fa"
        ));
        assert_eq!(
            actions.event_names(),
            [
                "snapshot",
                "clear_config",
                "session_data",
                "global_probe",
                "restore_cookies",
                "saved_probe"
            ]
        );
    }

    #[tokio::test]
    async fn credential_fallback_preserves_unauthorized_as_session_invalidation() {
        let actions = Arc::new(FakeActions::available());
        actions.push_probe(Ok(CookieSessionProbe::Fallback));
        *actions.response.lock().unwrap() = Some(Ok(vrchat_response(
            401,
            json!({"message": "Expired"}).to_string(),
        )));
        let runtime = NonInteractiveAuthRuntime::new(actions.clone());

        let result = runtime.authenticate_last_saved_user().await;

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::SessionInvalidated {
                user_id,
                reason,
                status_code: Some(401),
            }) if user_id == "usr_owner" && reason == "Expired"
        ));
        assert!(actions.event_names().contains(&"credential_login".into()));
    }

    #[test]
    fn invalid_session_cleanup_keeps_last_user_and_runs_browser_cleanup_first() {
        let actions = Arc::new(FakeActions::available());
        let runtime = NonInteractiveAuthRuntime::new(actions.clone());

        runtime.clear_invalid_saved_session(" usr_owner ");

        assert_eq!(actions.event_names(), ["clear_browser", "record_logout"]);
    }

    #[tokio::test]
    async fn unavailable_saved_account_reports_the_existing_headless_error() {
        let actions = Arc::new(FakeActions::new(SavedAuthSnapshot {
            last_user_logged_in: None,
            saved_credentials_list: Vec::new(),
            auto_login_delay_enabled: false,
            auto_login_delay_seconds: 0,
            auto_login_status: SavedAuthAutoLoginStatus::NotConfigured,
            auto_login_reason: String::new(),
        }));
        let runtime = NonInteractiveAuthRuntime::new(actions);

        let result = runtime.authenticate_last_saved_user().await;

        assert!(matches!(
            result,
            Err(NonInteractiveAuthError::Failed(reason))
                if reason == "No saved account is available for headless login."
        ));
    }
}
