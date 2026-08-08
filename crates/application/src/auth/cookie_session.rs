use serde_json::Value;
use vrcx_0_core::json::JsonExt;
use vrcx_0_vrchat_client::auth::{config_get_input, current_user_get_input};
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiExecuteResponse};

use super::{auth_response_error_message, LoginApi};
use crate::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CookieProbeStage {
    Config,
    CurrentUser,
}

pub(super) enum CookieProbeResult {
    Authenticated {
        response: HttpApiExecuteResponse,
        user: Value,
    },
    MissingCredentials(HttpApiExecuteResponse),
    RequiresTwoFactor(HttpApiExecuteResponse),
    UserMismatch,
    Rejected {
        stage: CookieProbeStage,
        response: HttpApiExecuteResponse,
    },
}

pub(super) async fn probe_cookie_session(
    api: &dyn LoginApi,
    endpoint: &str,
    expected_user_id: &str,
) -> Result<CookieProbeResult> {
    let config_response = api
        .execute(config_get_input(endpoint.to_string()), ApiScope::Vrchat)
        .await?;
    if response_is_missing_credentials(&config_response) {
        return Ok(CookieProbeResult::MissingCredentials(config_response));
    }
    if config_response.status != 200 {
        return Ok(CookieProbeResult::Rejected {
            stage: CookieProbeStage::Config,
            response: config_response,
        });
    }

    let response = api
        .execute(
            current_user_get_input(endpoint.to_string()),
            ApiScope::Vrchat,
        )
        .await?;
    if response_is_missing_credentials(&response) {
        return Ok(CookieProbeResult::MissingCredentials(response));
    }
    if response.status != 200 {
        return Ok(CookieProbeResult::Rejected {
            stage: CookieProbeStage::CurrentUser,
            response,
        });
    }

    let user = serde_json::from_str::<Value>(&response.data)
        .map_err(|error| Error::Custom(format!("parse current user response: {error}")))?;
    if user
        .get("requiresTwoFactorAuth")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.is_empty())
    {
        return Ok(CookieProbeResult::RequiresTwoFactor(response));
    }

    let actual_user_id = user.scalar_field("id").unwrap_or_default();
    if actual_user_id.is_empty() {
        return Err(Error::Custom(
            "The auth request did not return a current user payload.".into(),
        ));
    }
    let expected_user_id = expected_user_id.trim();
    if !expected_user_id.is_empty() && actual_user_id != expected_user_id {
        return Ok(CookieProbeResult::UserMismatch);
    }

    Ok(CookieProbeResult::Authenticated { response, user })
}

fn response_is_missing_credentials(response: &HttpApiExecuteResponse) -> bool {
    response.status == 401
        && auth_response_error_message(response, String::new()).contains("Missing Credentials")
}
