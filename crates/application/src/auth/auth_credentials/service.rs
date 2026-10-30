use super::storage::AuthCredentialStore;
use crate::auth::AuthSessionCookies;

use super::compat::{
    normalize_text, saved_credential_user_from_value, saved_login_params_from_value,
};
use super::snapshot::build_saved_auth_snapshot;
use super::storage::{
    get_config_string, read_saved_credentials, remove_config_value, set_config_string,
    write_saved_credentials, LAST_USER_LOGGED_IN_KEY,
};
use super::types::{
    LoginSuccessRecordInput, LogoutRecordInput, SavedAuthSnapshot, SavedCredential,
    SavedCredentialRecordMode,
};
use vrcx_0_application_core::{Error, Result};

pub fn delete_saved_credential(
    config: &dyn AuthCredentialStore,
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

pub fn clear_saved_password(
    config: &dyn AuthCredentialStore,
    user_id: String,
) -> Result<SavedAuthSnapshot> {
    let user_id = normalize_text(user_id);
    let mut saved_credentials = read_saved_credentials(config)?;
    let Some(record) = saved_credentials.get_mut(&user_id) else {
        return Err(Error::Custom(
            "No saved credential exists for this account.".into(),
        ));
    };
    record.login_params.password = None;
    record.cookies = None;
    write_saved_credentials(config, &saved_credentials)?;
    build_saved_auth_snapshot(config)
}

pub fn record_login_success(
    config: &dyn AuthCredentialStore,
    cookies: &dyn AuthSessionCookies,
    input: LoginSuccessRecordInput,
) -> Result<SavedAuthSnapshot> {
    let Some(user) = saved_credential_user_from_value(input.user.as_value(), "") else {
        return Err(Error::Custom(
            "VrchatAuthLoginSuccessRecord requires a user id.".into(),
        ));
    };
    let user_id = user.id.clone();
    let mut saved_credentials = read_saved_credentials(config)?;
    let cookies = match cookies.get() {
        cookies if cookies.is_empty() => None,
        cookies => Some(cookies),
    };

    let login_params = input
        .stored_login_params
        .as_ref()
        .unwrap_or(&input.login_params);
    match (input.record, saved_credentials.get_mut(&user_id)) {
        (SavedCredentialRecordMode::WithPassword, _) => {
            saved_credentials.insert(
                user_id.clone(),
                SavedCredential {
                    user,
                    login_params: saved_login_params_from_value(login_params.as_value()),
                    cookies,
                },
            );
        }
        (_, Some(existing_record)) => {
            existing_record.user = user;
            existing_record.cookies = cookies.filter(|_| existing_record.has_saved_password());
        }
        (SavedCredentialRecordMode::WithoutPassword, None) => {
            let mut params = saved_login_params_from_value(login_params.as_value());
            if params.username.trim().is_empty() {
                params.username = user.username.clone().unwrap_or_default();
            }
            params.password = None;
            saved_credentials.insert(
                user_id.clone(),
                SavedCredential {
                    user,
                    login_params: params,
                    cookies: None,
                },
            );
        }
        (SavedCredentialRecordMode::ExistingOnly, None) => {}
    }

    write_saved_credentials(config, &saved_credentials)?;
    set_config_string(config, LAST_USER_LOGGED_IN_KEY, &user_id)?;
    build_saved_auth_snapshot(config)
}

pub fn record_logout(
    config: &dyn AuthCredentialStore,
    cookies: &dyn AuthSessionCookies,
    input: LogoutRecordInput,
) -> Result<SavedAuthSnapshot> {
    let user_id = normalize_text(input.user_id);

    sync_saved_credential_cookies(config, cookies, &user_id)?;

    if input.clear_last_user_logged_in {
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }
    build_saved_auth_snapshot(config)
}

pub(super) fn sync_saved_credential_cookies(
    config: &dyn AuthCredentialStore,
    cookies: &dyn AuthSessionCookies,
    user_id: &str,
) -> Result<()> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(());
    }
    let mut saved_credentials = read_saved_credentials(config)?;
    if let Some(existing_record) = saved_credentials.get_mut(&user_id) {
        let cookies = cookies.get();
        existing_record.cookies =
            (!cookies.is_empty() && existing_record.has_saved_password()).then_some(cookies);
        write_saved_credentials(config, &saved_credentials)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
