use std::sync::Arc;

use super::{
    AuthenticatedRuntimeSession, AutoLoginOutcome, AutoLoginStartInput, BackendRuntimeSnapshot,
    LoginRuntimeTransition, LoginSessionCancelInput, LoginSessionEnd, LoginSessionEndRequest,
    LoginSessionRespondInput, LoginSessionStartInput, LoginSessionState, NonInteractiveAuthError,
    Result, RuntimeHostState, RuntimeRealtimeTransportEpoch, SavedAuthSnapshot,
};

impl RuntimeHostState {
    fn apply_login_transition(
        &self,
        transition: LoginRuntimeTransition,
    ) -> std::result::Result<(), String> {
        match transition {
            LoginRuntimeTransition::Authenticating => {
                self.begin_frontend_authentication();
                Ok(())
            }
            LoginRuntimeTransition::Authenticated(session) => self
                .start_authenticated_runtime_session(session)
                .map(|_| ())
                .map_err(|error| error.to_string()),
            LoginRuntimeTransition::Unauthenticated(reason) => {
                self.clear_backend_authenticated_session(reason);
                Ok(())
            }
        }
    }

    pub async fn start_login_session(&self, input: LoginSessionStartInput) -> LoginSessionState {
        self.web.clear_vrchat_config_snapshot();
        self.runtime_context
            .login_session
            .start(
                Arc::clone(&self.runtime_context.login_api),
                self.runtime_context.auth_cookies.as_ref(),
                self.runtime_context.auth_credentials.as_ref(),
                input,
                &|transition| self.apply_login_transition(transition),
            )
            .await
    }

    pub async fn start_auto_login(&self, input: AutoLoginStartInput) -> Result<AutoLoginOutcome> {
        self.web.clear_vrchat_config_snapshot();
        self.runtime_context
            .login_session
            .auto_login_start(
                Arc::clone(&self.runtime_context.login_api),
                self.runtime_context.auth_cookies.as_ref(),
                self.runtime_context.auth_credentials.as_ref(),
                input,
                &|transition| self.apply_login_transition(transition),
            )
            .await
            .map_err(Into::into)
    }

    pub async fn respond_login_session(
        &self,
        input: LoginSessionRespondInput,
    ) -> LoginSessionState {
        self.runtime_context
            .login_session
            .respond_and_transition(
                input,
                self.runtime_context.auth_cookies.as_ref(),
                self.runtime_context.auth_credentials.as_ref(),
                &|transition| self.apply_login_transition(transition),
            )
            .await
    }

    pub async fn cancel_login_session(&self, input: LoginSessionCancelInput) -> LoginSessionState {
        self.runtime_context
            .login_session
            .cancel(
                input.attempt_id,
                self.runtime_context.auth_cookies.as_ref(),
                &|transition| self.apply_login_transition(transition),
            )
            .await
    }

    pub async fn end_login_session(
        &self,
        kind: LoginSessionEnd,
    ) -> Result<Option<SavedAuthSnapshot>> {
        let user_id = match &kind {
            LoginSessionEnd::Logout => self
                .authenticated_session_projection()
                .session
                .map(|session| session.user_id)
                .unwrap_or_default(),
            LoginSessionEnd::Invalidated {
                expected_user_id, ..
            } => expected_user_id.clone(),
        };
        self.runtime_context
            .login_session
            .end_session(
                self.runtime_context.auth_cookies.as_ref(),
                self.runtime_context.auth_credentials.as_ref(),
                LoginSessionEndRequest { user_id, kind },
                &|kind| self.login_session_invalidation_matches(kind),
                &|transition| self.apply_login_transition(transition),
            )
            .await
            .map_err(Into::into)
    }

    fn login_session_invalidation_matches(&self, kind: &LoginSessionEnd) -> bool {
        if matches!(kind, LoginSessionEnd::Logout) {
            return true;
        }
        let Some(session) = self.authenticated_session_projection().session else {
            return false;
        };
        let active = self
            .authenticated_runtime
            .snapshot()
            .realtime_transport
            .map(|transport| RuntimeRealtimeTransportEpoch {
                client_run_id: transport.client_run_id,
                generation: transport.generation,
                session_generation: transport.session_generation,
            });
        kind.matches_invalidation(
            &session.user_id,
            session.auth_scope_generation,
            active.as_ref(),
        )
    }

    pub(super) async fn authenticate_non_interactive(
        &self,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        self.runtime_context
            .noninteractive_auth
            .authenticate_last_saved_user()
            .await
    }

    pub(super) async fn authenticate_non_interactive_for_saved_user(
        &self,
        user_id: &str,
        endpoint: &str,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        self.runtime_context
            .noninteractive_auth
            .authenticate_saved_user(user_id, endpoint)
            .await
    }

    pub(super) fn clear_invalid_non_interactive_auth_session(
        &self,
        user_id: &str,
        reason: &str,
    ) -> BackendRuntimeSnapshot {
        self.runtime_context
            .noninteractive_auth
            .clear_invalid_saved_session(user_id);
        self.runtime_context.auth_scope.set("", "");
        self.clear_backend_authenticated_session(reason)
    }
}

pub struct CliTwoFactorChoice {
    pub method: String,
    pub code: String,
}

pub trait CliLoginPrompt: Send + Sync + 'static {
    fn prompt_username(&self) -> std::io::Result<String>;
    fn prompt_password(&self) -> std::io::Result<String>;
    fn prompt_two_factor(&self, methods: &[String]) -> std::io::Result<CliTwoFactorChoice>;
}

async fn run_blocking_prompt<T, F>(f: F) -> std::result::Result<T, NonInteractiveAuthError>
where
    F: FnOnce() -> std::io::Result<T> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))
}

impl RuntimeHostState {
    pub(super) async fn authenticate_cli_interactive(
        &self,
        prompt: Arc<dyn CliLoginPrompt>,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let prompt_username = Arc::clone(&prompt);
        let username = run_blocking_prompt(move || prompt_username.prompt_username()).await?;

        let prompt_password = Arc::clone(&prompt);
        let password = run_blocking_prompt(move || prompt_password.prompt_password()).await?;

        let mut state = self
            .start_login_session(LoginSessionStartInput::Basic {
                username,
                password,
                save_credentials: false,
            })
            .await;

        loop {
            let (attempt_id, methods) = match &state {
                LoginSessionState::Authenticated { session, .. } => return Ok(session.clone()),
                LoginSessionState::Failed { reason, .. } => {
                    return Err(NonInteractiveAuthError::Failed(reason.clone()));
                }
                LoginSessionState::Cancelled | LoginSessionState::DeviceApproval { .. } => {
                    return Err(NonInteractiveAuthError::Failed(
                        "Login was cancelled.".into(),
                    ));
                }
                LoginSessionState::Challenge {
                    attempt_id,
                    methods,
                    ..
                } => (
                    attempt_id.clone(),
                    methods
                        .iter()
                        .map(|method| method.as_str().to_string())
                        .collect::<Vec<_>>(),
                ),
            };

            let prompt_2fa = Arc::clone(&prompt);
            let choice =
                run_blocking_prompt(move || prompt_2fa.prompt_two_factor(&methods)).await?;
            state = self
                .respond_login_session(LoginSessionRespondInput {
                    attempt_id,
                    method: choice.method.into(),
                    code: choice.code,
                })
                .await;

            if let LoginSessionState::Challenge {
                error: Some(reason),
                ..
            } = &state
            {
                return Err(NonInteractiveAuthError::Failed(reason.clone()));
            }
        }
    }
}
