use super::*;

impl RuntimeHostState {
    fn login_api(&self) -> Arc<dyn LoginApi> {
        Arc::new(WebClientLoginApi::new(
            Arc::clone(&self.web),
            Arc::clone(&self.db),
        ))
    }

    pub(super) async fn authenticate_non_interactive(
        &self,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let snapshot = saved_snapshot(self.runtime_context.config())
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        let last_user = string_field(&snapshot, "lastUserLoggedIn").unwrap_or_default();
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
        snapshot: serde_json::Value,
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
            self.web.as_ref(),
            self.db.as_ref(),
            user_id.clone(),
            endpoint.clone(),
            websocket.clone(),
            false,
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
                match probe_current_user_from_cookie(
                    self.web.as_ref(),
                    self.db.as_ref(),
                    user_id.clone(),
                    endpoint.clone(),
                    websocket.clone(),
                    true,
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

        let fallback_available = snapshot
            .get("savedCredentialFallbackAvailable")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if !fallback_available {
            return Err(NonInteractiveAuthError::Failed(
                "Saved credentials are not available for headless login.".into(),
            ));
        }

        let api = self.login_api();
        let response = saved_credential_login_start(
            self.runtime_context.config(),
            self.web.as_ref(),
            api.as_ref(),
            SavedCredentialLoginStartInput {
                user_id: user_id.clone(),
                endpoint: endpoint.clone(),
            },
        )
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if response.status == 403 {
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
                    user_or_user_id: Value::String(user_id.trim().to_string()),
                    clear_last_user_logged_in: Some(false),
                    cookies: Some(Value::Null),
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
        let endpoint = String::new();

        let prompt_username = Arc::clone(&prompt);
        let username = run_blocking_prompt(move || prompt_username.prompt_username()).await?;

        let prompt_password = Arc::clone(&prompt);
        let password = run_blocking_prompt(move || prompt_password.prompt_password()).await?;

        let api = self.login_api();
        let mut login = LoginSession::start(api, endpoint, username, password).await;

        loop {
            let methods = match login.state() {
                LoginSessionState::Authenticated { .. } => break,
                LoginSessionState::Failed { reason, .. } => {
                    return Err(NonInteractiveAuthError::Failed(reason.clone()));
                }
                LoginSessionState::Cancelled => {
                    return Err(NonInteractiveAuthError::Failed(
                        "Login was cancelled.".into(),
                    ));
                }
                LoginSessionState::Challenge { methods, .. } => methods.clone(),
            };

            let prompt_2fa = Arc::clone(&prompt);
            let choice =
                run_blocking_prompt(move || prompt_2fa.prompt_two_factor(&methods)).await?;
            login.respond(choice.method, choice.code).await;

            if let LoginSessionState::Challenge {
                error: Some(reason),
                ..
            } = login.state()
            {
                return Err(NonInteractiveAuthError::Failed(reason.clone()));
            }
        }

        let LoginSessionState::Authenticated { session } = login.into_state() else {
            unreachable!("loop only breaks once the session is Authenticated");
        };
        self.record_non_interactive_login_success(&session)?;
        Ok(session)
    }
}
