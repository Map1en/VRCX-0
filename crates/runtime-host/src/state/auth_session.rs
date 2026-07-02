use super::*;

impl RuntimeHostState {
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

        let raw_saved_credentials = self
            .runtime_context
            .config()
            .get_json(SAVED_CREDENTIALS_KEY, serde_json::json!({}))
            .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        let saved_record = raw_saved_credentials.get(&last_user).cloned();
        let endpoint = saved_record
            .as_ref()
            .and_then(|record| record.get("loginParams"))
            .and_then(|login_params| string_field(login_params, "endpoint"))
            .unwrap_or_default();
        let websocket = saved_record
            .as_ref()
            .and_then(|record| record.get("loginParams"))
            .and_then(|login_params| string_field(login_params, "websocket"))
            .unwrap_or_default();

        match probe_current_user_from_cookie(
            self.web.as_ref(),
            self.db.as_ref(),
            last_user.clone(),
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

        if let Some(cookies) = saved_record
            .as_ref()
            .and_then(|record| record.get("cookies"))
            .and_then(serde_json::Value::as_str)
            .filter(|cookies| !cookies.trim().is_empty())
        {
            if let Err(error) = self.web.set_cookies(cookies) {
                tracing::warn!(error = %error, "failed to restore saved auth cookies");
            } else {
                match probe_current_user_from_cookie(
                    self.web.as_ref(),
                    self.db.as_ref(),
                    last_user.clone(),
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

        let response = saved_credential_login_start(
            self.runtime_context.config(),
            self.web.as_ref(),
            self.db.as_ref(),
            SavedCredentialLoginStartInput {
                user_id: last_user.clone(),
                endpoint: endpoint.clone(),
            },
        )
        .await
        .map_err(|error| NonInteractiveAuthError::Failed(error.to_string()))?;
        if response.status == 403 {
            return Err(NonInteractiveAuthError::SessionInvalidated {
                user_id: last_user.clone(),
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

    pub(super) async fn build_backend_social_baseline(
        &self,
        session: &AuthenticatedRuntimeSession,
    ) -> Result<BackendSocialBaseline> {
        let deps = SocialBaselineDeps {
            db: Arc::clone(&self.db),
            web: Arc::clone(&self.web),
            auth_scope: self.runtime_context.auth_scope.clone(),
            session: self.runtime_context.session.clone(),
        };
        let output = build_friend_roster_baseline(
            deps.clone(),
            SocialFriendRosterBaselineInput {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                websocket: session.websocket.clone(),
                current_user_snapshot: RawJson::from(session.current_user.clone()),
                is_first_load: true,
            },
        )
        .await?;
        let Some(snapshot) = output.snapshot else {
            return Ok(BackendSocialBaseline::default());
        };
        let snapshot = snapshot.into_value();
        let friends_by_id = snapshot
            .get("friendsById")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let friends_by_id_map =
            serde_json::from_value::<HashMap<String, FriendRecord>>(friends_by_id.clone())?;
        let favorite_groups = match build_favorites_baseline(
            deps,
            SocialFavoritesBaselineInput {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                current_user_snapshot: RawJson::from(session.current_user.clone()),
                friend_roster_by_id: RawJson::from(friends_by_id),
            },
        )
        .await
        {
            Ok(output) => output
                .snapshot
                .map(|snapshot| favorite_group_membership_from_snapshot(snapshot.into_value()))
                .unwrap_or_default(),
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "failed to build backend favorite baseline for overlay activity"
                );
                HashMap::new()
            }
        };
        Ok(BackendSocialBaseline {
            friends_by_id: friends_by_id_map,
            favorite_groups,
        })
    }
}

#[derive(Default)]
pub(super) struct BackendSocialBaseline {
    pub(super) friends_by_id: HashMap<String, FriendRecord>,
    pub(super) favorite_groups: HashMap<String, Vec<String>>,
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

impl RuntimeHostState {
    pub(super) async fn authenticate_cli_interactive(
        &self,
    ) -> std::result::Result<AuthenticatedRuntimeSession, NonInteractiveAuthError> {
        let endpoint = String::new();

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        print!("Username/Email: ");
        std::io::Write::flush(&mut std::io::stdout())
            .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

        let mut username = String::new();
        std::io::stdin()
            .read_line(&mut username)
            .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;
        let username = username.trim().to_string();

        let password = rpassword::prompt_password("Password: ")
            .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

        let (_, request) = vrcx_0_application::vrchat_api::auth::login_basic_input(
            endpoint.clone(),
            username.clone(),
            password,
            "Username is required.",
            "Password is required.",
        )
        .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

        let response = self
            .web
            .execute_api(
                request,
                vrcx_0_vrchat_client::http_api::ApiScope::Vrchat,
                self.db.as_ref(),
            )
            .await
            .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

        let mut current_user_json: serde_json::Value = serde_json::from_str(&response.data)
            .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

        if response.status == 200 && current_user_json.get("requiresTwoFactorAuth").is_some() {
            let methods = current_user_json["requiresTwoFactorAuth"]
                .as_array()
                .cloned()
                .unwrap_or_default();

            if !methods.is_empty() {
                let mut methods_str: Vec<String> = methods
                    .into_iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();

                methods_str.sort_by_key(|m| match m.as_str() {
                    "totp" => 0,
                    "emailOtp" => 1,
                    "otp" => 2,
                    _ => 3,
                });

                println!("2FA is required. Select an authentication method:");
                for (i, method) in methods_str.iter().enumerate() {
                    println!("{}: {}", i + 1, method);
                }
                print!("Selection [1]: ");
                std::io::Write::flush(&mut std::io::stdout())
                    .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

                let mut selection = String::new();
                std::io::stdin()
                    .read_line(&mut selection)
                    .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;
                let selection = selection.trim();
                let method_idx = if selection.is_empty() {
                    0
                } else {
                    selection.parse::<usize>().unwrap_or(1).saturating_sub(1)
                };

                let selected_method = methods_str.get(method_idx).unwrap_or(&methods_str[0]);

                let code = rpassword::prompt_password(format!("Enter {} code: ", selected_method))
                    .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

                let verify_req = match selected_method.as_str() {
                    "emailOtp" => vrcx_0_application::vrchat_api::auth::email_otp_verify_input(
                        endpoint.clone(),
                        code,
                    ),
                    "otp" => vrcx_0_application::vrchat_api::auth::otp_verify_input(
                        endpoint.clone(),
                        code,
                    ),
                    _ => vrcx_0_application::vrchat_api::auth::totp_verify_input(
                        endpoint.clone(),
                        code,
                    ),
                };

                let verify_response = self
                    .web
                    .execute_api(
                        verify_req,
                        vrcx_0_vrchat_client::http_api::ApiScope::Vrchat,
                        self.db.as_ref(),
                    )
                    .await
                    .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

                if verify_response.status != 200 {
                    return Err(NonInteractiveAuthError::Failed(format!(
                        "2FA verification failed with HTTP {}",
                        verify_response.status
                    )));
                }

                let user_req =
                    vrcx_0_application::vrchat_api::auth::current_user_get_input(endpoint.clone());
                let user_response = self
                    .web
                    .execute_api(
                        user_req,
                        vrcx_0_vrchat_client::http_api::ApiScope::Vrchat,
                        self.db.as_ref(),
                    )
                    .await
                    .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;

                if user_response.status != 200 {
                    return Err(NonInteractiveAuthError::Failed(format!(
                        "Failed to fetch user profile after 2FA: HTTP {}",
                        user_response.status
                    )));
                }

                current_user_json = serde_json::from_str(&user_response.data)
                    .map_err(|e| NonInteractiveAuthError::Failed(e.to_string()))?;
            }
        } else if response.status != 200 {
            let error_msg = auth_response_error_message(
                &response,
                format!("Login failed with HTTP {}", response.status),
            );
            return Err(NonInteractiveAuthError::Failed(error_msg));
        }

        let user_id = string_field(&current_user_json, "id").unwrap_or_default();
        if user_id.is_empty() {
            return Err(NonInteractiveAuthError::Failed(
                "The auth request did not return a valid user payload.".into(),
            ));
        }

        let session =
            AuthenticatedRuntimeSession::from_user(current_user_json, endpoint, String::new());
        self.record_non_interactive_login_success(&session)?;
        Ok(session)
    }
}
