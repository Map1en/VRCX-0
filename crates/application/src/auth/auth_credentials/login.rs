use super::storage::AuthCredentialStore;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::compat::normalize_text;
use super::service::sync_saved_credential_cookies;
use super::storage::read_saved_credentials;
use super::types::SavedCredentialLoginStartInput;
use crate::auth::cookie_session::probe_cookie_session;
use crate::auth::{AuthSessionCookies, LoginApi, LoginRemoteOperation};
use vrcx_0_application_core::{Error, Result};
use vrcx_0_vrchat_protocol::auth::login::CookieProbeResult;

pub async fn saved_credential_login_start(
    config: &dyn AuthCredentialStore,
    cookies: &dyn AuthSessionCookies,
    api: &dyn LoginApi,
    input: SavedCredentialLoginStartInput,
) -> Result<VrchatResponse> {
    saved_credential_login_start_with_api(config, cookies, api, input).await
}

pub(crate) async fn saved_credential_login_start_with_api(
    config: &dyn AuthCredentialStore,
    cookies: &dyn AuthSessionCookies,
    api: &dyn LoginApi,
    input: SavedCredentialLoginStartInput,
) -> Result<VrchatResponse> {
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
        CookieProbeResult::UserMismatch { actual_user_id } => {
            sync_saved_credential_cookies(config, cookies, &actual_user_id)?;
        }
        CookieProbeResult::MissingCredentials(_) | CookieProbeResult::RequiresTwoFactor(_) => {}
    }

    cookies.clear();
    if let Some(cookie) = saved_credential.cookies.as_deref() {
        if let Err(error) = cookies.set(cookie) {
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
        CookieProbeResult::MissingCredentials(_) | CookieProbeResult::UserMismatch { .. } => {}
    }

    let config_response = api
        .execute(LoginRemoteOperation::Config {
            endpoint: endpoint.clone(),
        })
        .await?;
    if config_response.status != 200 {
        return Ok(config_response);
    }
    api.execute(LoginRemoteOperation::BasicLogin {
        endpoint,
        username,
        password,
    })
    .await
}
