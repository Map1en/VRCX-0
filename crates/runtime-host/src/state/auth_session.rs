use super::*;

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
        self.runtime_context
            .login_session
            .start(
                Arc::clone(&self.web),
                Arc::clone(&self.db),
                self.runtime_context.config(),
                input,
                &|transition| self.apply_login_transition(transition),
            )
            .await
    }

    pub async fn start_auto_login(&self, input: AutoLoginStartInput) -> Result<AutoLoginOutcome> {
        self.runtime_context
            .login_session
            .auto_login_start(
                Arc::clone(&self.web),
                Arc::clone(&self.db),
                self.runtime_context.config(),
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
                self.web.as_ref(),
                self.db.as_ref(),
                self.runtime_context.config(),
                &|transition| self.apply_login_transition(transition),
            )
            .await
    }

    pub async fn cancel_login_session(&self, input: LoginSessionCancelInput) -> LoginSessionState {
        self.runtime_context
            .login_session
            .cancel(
                input.attempt_id,
                self.web.as_ref(),
                self.db.as_ref(),
                &|transition| self.apply_login_transition(transition),
            )
            .await
    }

    pub async fn end_login_session(
        &self,
        kind: LoginSessionEnd,
    ) -> Result<Option<SavedAuthSnapshot>> {
        let user_id = match &kind {
            LoginSessionEnd::Logout => self.runtime_context.auth_scope.snapshot().current_user_id,
            LoginSessionEnd::Invalidated {
                expected_user_id, ..
            } => expected_user_id.clone(),
        };
        self.runtime_context
            .login_session
            .end_session(
                self.web.as_ref(),
                self.db.as_ref(),
                self.runtime_context.config(),
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
        let scope = self.runtime_context.auth_scope.snapshot();
        if !scope.active {
            return false;
        }
        let active = self
            .authenticated_runtime
            .snapshot()
            .realtime_transport
            .map(|transport| RuntimeRealtimeTransportEpoch {
                client_run_id: transport.client_run_id,
                generation: transport.generation,
                session_generation: transport.session_generation,
            });
        kind.matches_invalidation(&scope.current_user_id, scope.generation, active.as_ref())
    }

    pub(super) async fn authenticate_non_interactive(
        &self,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let snapshot = saved_snapshot(self.runtime_context.config())
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        let last_user = snapshot.last_user_logged_in.clone().unwrap_or_default();
        if last_user.is_empty() {
            return Err(NonInteractiveAuthError::Failed(
                "No saved account is available for headless login.".into(),
            ));
        }

        self.authenticate_non_interactive_saved_user(last_user, None, snapshot)
            .await
    }

    pub(super) async fn authenticate_non_interactive_for_saved_user(
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
        let snapshot = saved_snapshot(self.runtime_context.config())
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        self.authenticate_non_interactive_saved_user(
            user_id.to_string(),
            Some(endpoint.to_string()),
            snapshot,
        )
        .await
    }

    async fn authenticate_non_interactive_saved_user(
        &self,
        user_id: String,
        endpoint_override: Option<String>,
        snapshot: SavedAuthSnapshot,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let saved_record = saved_credential_session_data(self.runtime_context.config(), &user_id)
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        let (saved_endpoint, websocket, saved_cookies) = saved_record.map_or_else(
            || (String::new(), String::new(), None),
            |record| (record.endpoint, record.websocket, record.cookies),
        );
        let endpoint = endpoint_override
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(saved_endpoint);

        match probe_current_user_from_cookie(
            Arc::clone(&self.web),
            Arc::clone(&self.db),
            user_id.clone(),
            endpoint.clone(),
            websocket.clone(),
        )
        .await
        {
            Ok(CookieSessionProbe::Authenticated(session)) => {
                self.record_non_interactive_login_success(&session)?;
                return Ok(session);
            }
            Ok(CookieSessionProbe::Fallback) => {}
            Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                return Err(NonInteractiveAuthError::InteractionRequired(reason));
            }
            Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason }) => {
                return Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason });
            }
            Err(NonInteractiveAuthError::Failed(reason)) => {
                tracing::warn!(reason, "global cookie auth restore failed");
            }
        }

        if let Some(cookies) = saved_cookies.as_deref() {
            if let Err(error) = self.web.set_cookies(cookies) {
                tracing::warn!(error = %error, "failed to restore saved auth cookies");
            } else {
                match probe_saved_current_user_from_cookie(
                    Arc::clone(&self.web),
                    Arc::clone(&self.db),
                    user_id.clone(),
                    endpoint.clone(),
                    websocket.clone(),
                )
                .await
                {
                    Ok(CookieSessionProbe::Authenticated(session)) => {
                        self.record_non_interactive_login_success(&session)?;
                        return Ok(session);
                    }
                    Ok(CookieSessionProbe::Fallback) => {}
                    Err(NonInteractiveAuthError::InteractionRequired(reason)) => {
                        return Err(NonInteractiveAuthError::InteractionRequired(reason));
                    }
                    Err(NonInteractiveAuthError::SessionInvalidated { user_id, reason }) => {
                        return Err(NonInteractiveAuthError::SessionInvalidated {
                            user_id,
                            reason,
                        });
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

        let response = saved_credential_login_start(
            self.runtime_context.config(),
            Arc::clone(&self.web),
            Arc::clone(&self.db),
            SavedCredentialLoginStartInput {
                user_id: user_id.clone(),
                endpoint: endpoint.clone(),
            },
        )
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if matches!(response.status, 401 | 403) {
            return Err(NonInteractiveAuthError::SessionInvalidated {
                user_id: user_id.clone(),
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
        self.record_non_interactive_login_success(&session)?;
        Ok(session)
    }

    fn record_non_interactive_login_success(
        &self,
        session: &AuthenticatedRuntimeSession,
    ) -> std::result::Result<(), NonInteractiveAuthError> {
        record_login_success(
            self.runtime_context.config(),
            self.web.as_ref(),
            LoginSuccessRecordInput {
                user: session.current_user.clone(),
                login_params: serde_json::json!({
                    "endpoint": session.endpoint,
                    "websocket": session.websocket,
                }),
                stored_login_params: None,
                save_credentials: false,
            },
        )
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        Ok(())
    }

    pub(super) fn clear_invalid_non_interactive_auth_session(
        &self,
        user_id: &str,
        reason: &str,
    ) -> BackendRuntimeSnapshot {
        self.web.clear_cookies();
        self.web.save_cookies(&self.db);
        self.runtime_context.auth_scope.set("", "");
        if !user_id.trim().is_empty() {
            if let Err(error) = record_logout(
                self.runtime_context.config(),
                self.web.as_ref(),
                LogoutRecordInput {
                    user_id: user_id.trim().to_string(),
                    clear_last_user_logged_in: false,
                },
            ) {
                tracing::warn!(
                    error = %error,
                    user_id = %user_id,
                    "failed to clear saved auth after invalid VRChat session"
                );
            }
        }
        self.clear_backend_authenticated_session(reason)
    }
}

pub(super) fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(|value| match value {
            serde_json::Value::String(value) => Some(value.trim().to_string()),
            serde_json::Value::Number(value) => Some(value.to_string()),
            serde_json::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
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
                LoginSessionState::Cancelled => {
                    return Err(NonInteractiveAuthError::Failed(
                        "Login was cancelled.".into(),
                    ));
                }
                LoginSessionState::Challenge {
                    attempt_id,
                    methods,
                    ..
                } => (attempt_id.clone(), methods.clone()),
            };

            let prompt_2fa = Arc::clone(&prompt);
            let choice =
                run_blocking_prompt(move || prompt_2fa.prompt_two_factor(&methods)).await?;
            state = self
                .respond_login_session(LoginSessionRespondInput {
                    attempt_id,
                    method: choice.method,
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
