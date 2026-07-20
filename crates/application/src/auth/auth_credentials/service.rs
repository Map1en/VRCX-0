use vrcx_0_application_core::WebClient;
use vrcx_0_persistence::config::ConfigRepository;

use super::compat::{
    normalize_text, saved_credential_user_from_value, saved_login_params_from_value,
};
use super::snapshot::build_saved_auth_snapshot;
use super::storage::{
    get_config_string, read_saved_credentials, remove_config_value, set_config_string,
    write_saved_credentials, LAST_USER_LOGGED_IN_KEY,
};
use super::types::{LoginSuccessRecordInput, LogoutRecordInput, SavedAuthSnapshot};
use crate::{Error, Result};

pub fn delete_saved_credential(
    config: &ConfigRepository,
    user_id: String,
) -> Result<SavedAuthSnapshot> {
    let user_id = normalize_text(user_id);
    let mut saved_credentials = read_saved_credentials(config)?;
    saved_credentials.remove(&user_id);
    write_saved_credentials(config, &saved_credentials)?;

    let last_user_logged_in = get_config_string(config, LAST_USER_LOGGED_IN_KEY, "")?;
    if last_user_logged_in == user_id {
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }

    build_saved_auth_snapshot(config)
}

pub fn record_login_success(
    config: &ConfigRepository,
    web: &WebClient,
    input: LoginSuccessRecordInput,
) -> Result<SavedAuthSnapshot> {
    let Some(user) = saved_credential_user_from_value(&input.user, "") else {
        return Err(Error::Custom(
            "VrchatAuthLoginSuccessRecord requires a user id.".into(),
        ));
    };
    let user_id = user.id.clone();
    let mut saved_credentials = read_saved_credentials(config)?;

    if input.save_credentials {
        let login_params = input
            .stored_login_params
            .as_ref()
            .unwrap_or(&input.login_params);
        saved_credentials.insert(
            user_id.clone(),
            super::types::SavedCredential {
                user,
                login_params: saved_login_params_from_value(login_params),
                cookies: None,
            },
        );
    } else if let Some(existing_record) = saved_credentials.get_mut(&user_id) {
        existing_record.user = user;
        existing_record.cookies = match web.get_cookies() {
            cookies if cookies.is_empty() => None,
            cookies => Some(cookies),
        };
    }

    write_saved_credentials(config, &saved_credentials)?;
    set_config_string(config, LAST_USER_LOGGED_IN_KEY, &user_id)?;
    build_saved_auth_snapshot(config)
}

pub fn record_logout(
    config: &ConfigRepository,
    web: &WebClient,
    input: LogoutRecordInput,
) -> Result<SavedAuthSnapshot> {
    let user_id = normalize_text(input.user_id);

    if !user_id.is_empty() {
        let mut saved_credentials = read_saved_credentials(config)?;
        if let Some(existing_record) = saved_credentials.get_mut(&user_id) {
            let cookies = web.get_cookies();
            existing_record.cookies = (!cookies.is_empty()).then_some(cookies);
            write_saved_credentials(config, &saved_credentials)?;
        }
    }

    if input.clear_last_user_logged_in {
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }
    build_saved_auth_snapshot(config)
}

#[cfg(test)]
mod tests;
