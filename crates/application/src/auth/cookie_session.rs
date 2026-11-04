use vrcx_0_vrchat_protocol::auth::login::{
    interpret_cookie_probe_config_response, interpret_cookie_probe_current_user_response,
    CookieProbeResult,
};

use super::{LoginApi, LoginRemoteOperation};
use vrcx_0_application_core::{Error, Result};

pub(super) async fn probe_cookie_session(
    api: &dyn LoginApi,
    endpoint: &str,
    expected_user_id: &str,
) -> Result<CookieProbeResult> {
    let config_response = api
        .execute(LoginRemoteOperation::Config {
            endpoint: endpoint.to_string(),
        })
        .await?;
    if let Some(result) = interpret_cookie_probe_config_response(config_response) {
        return Ok(result);
    }

    let response = api
        .execute(LoginRemoteOperation::CurrentUser {
            endpoint: endpoint.to_string(),
        })
        .await?;
    interpret_cookie_probe_current_user_response(response, expected_user_id).map_err(Error::Custom)
}
