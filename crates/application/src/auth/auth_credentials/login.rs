use std::sync::Arc;

use vrcx_0_application_core::WebClient;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::auth::{config_get_input, login_basic_input};
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiExecuteResponse};

use super::compat::normalize_text;
use super::storage::read_saved_credentials;
use super::types::SavedCredentialLoginStartInput;
use crate::auth::cookie_session::{probe_cookie_session, CookieProbeResult};
use crate::auth::{LoginApi, WebClientLoginApi};
use crate::{Error, Result};

pub async fn saved_credential_login_start(
    config: &ConfigRepository,
    web: Arc<WebClient>,
    db: Arc<DatabaseService>,
    input: SavedCredentialLoginStartInput,
) -> Result<HttpApiExecuteResponse> {
    let api = WebClientLoginApi::new(Arc::clone(&web), db);
    saved_credential_login_start_with_api(config, web.as_ref(), &api, input).await
}

pub(crate) async fn saved_credential_login_start_with_api(
    config: &ConfigRepository,
    web: &WebClient,
    api: &dyn LoginApi,
    input: SavedCredentialLoginStartInput,
) -> Result<HttpApiExecuteResponse> {
    let user_id = normalize_text(input.user_id);
    if user_id.is_empty() {
        return Err(Error::Custom(
            "VrchatAuthSavedCredentialLoginStart requires a user id.".into(),
        ));
    }

    let saved_credentials = read_saved_credentials(config)?;
    let Some(saved_credential) = saved_credentials.get(&user_id) else {
        return Err(Error::Custom(
            "Saved credentials were not found for the requested account.".into(),
        ));
    };

    let username = saved_credential.login_params.username.clone();
    let password = saved_credential
        .login_params
        .password
        .clone()
        .unwrap_or_default();
    if username.trim().is_empty() || password.is_empty() {
        return Err(Error::Custom(
            "The saved account is missing username or password data.".into(),
        ));
    }

    let endpoint = normalize_text(input.endpoint);
    match probe_cookie_session(api, &endpoint, &user_id).await? {
        CookieProbeResult::Authenticated { response, .. }
        | CookieProbeResult::Rejected { response, .. } => return Ok(response),
        CookieProbeResult::MissingCredentials(_)
        | CookieProbeResult::RequiresTwoFactor(_)
        | CookieProbeResult::UserMismatch => {}
    }

    web.clear_cookies();
    if let Some(cookie) = saved_credential.cookies.as_deref() {
        if let Err(error) = web.set_cookies(cookie) {
            tracing::warn!(
                error = %error,
                user_id = %user_id,
                "failed to restore saved cookies before saved credential login; continuing with password login"
            );
        }
    }

    match probe_cookie_session(api, &endpoint, &user_id).await? {
        CookieProbeResult::Authenticated { response, .. }
        | CookieProbeResult::RequiresTwoFactor(response)
        | CookieProbeResult::Rejected { response, .. } => return Ok(response),
        CookieProbeResult::MissingCredentials(_) | CookieProbeResult::UserMismatch => {}
    }

    let config_response = api
        .execute(config_get_input(endpoint.clone()), ApiScope::Vrchat)
        .await?;
    if config_response.status != 200 {
        return Ok(config_response);
    }
    let (_, request) = login_basic_input(
        endpoint,
        username,
        password,
        "Saved credential login requires username.",
        "Saved credential login requires password.",
    )?;
    api.execute(request, ApiScope::Vrchat).await
}
