use vrcx_0_persistence::config::ConfigRepository;

use super::storage::{
    get_config_bool, get_config_string, read_saved_credentials, remove_config_value,
    write_saved_credentials, LAST_USER_LOGGED_IN_KEY,
};
use super::types::{
    SavedAuthAutoLoginStatus, SavedAuthSnapshot, SavedCredential, SavedCredentialSnapshot,
    SavedCredentials, SavedLoginParamsSnapshot,
};
use crate::Result;

const MAX_AUTO_LOGIN_DELAY_SECONDS: i64 = 10;
const LEGACY_PRIMARY_PASSWORD_KEY: &str = "enablePrimaryPassword";
const AUTO_LOGIN_DELAY_ENABLED_KEY: &str = "autoLoginDelayEnabled";
const AUTO_LOGIN_DELAY_SECONDS_KEY: &str = "autoLoginDelaySeconds";

pub fn saved_snapshot(config: &ConfigRepository) -> Result<SavedAuthSnapshot> {
    build_saved_auth_snapshot(config)
}

fn normalize_auto_login_delay_seconds(value: &str) -> i64 {
    value
        .trim()
        .parse::<i64>()
        .ok()
        .map(|value| value.clamp(0, MAX_AUTO_LOGIN_DELAY_SECONDS))
        .unwrap_or(0)
}

impl SavedCredential {
    fn has_login_credentials(&self) -> bool {
        !self.login_params.username.trim().is_empty()
            && self
                .login_params
                .password
                .as_deref()
                .is_some_and(|password| !password.trim().is_empty())
    }

    fn has_cookies(&self) -> bool {
        self.cookies
            .as_deref()
            .is_some_and(|cookies| !cookies.is_empty())
    }

    fn redacted(&self) -> SavedCredentialSnapshot {
        SavedCredentialSnapshot {
            user: self.user.clone(),
            login_params: SavedLoginParamsSnapshot {
                username: self.login_params.username.clone(),
            },
            has_login_credentials: self.has_login_credentials(),
            has_cookies: self.has_cookies(),
        }
    }
}

fn resolve_auto_login_status(
    last_user_logged_in: &str,
    saved_credentials: &SavedCredentials,
    auto_login_delay_enabled: bool,
    auto_login_delay_seconds: i64,
) -> (SavedAuthAutoLoginStatus, String) {
    if last_user_logged_in.is_empty() {
        return (
            SavedAuthAutoLoginStatus::NotConfigured,
            "No previous login was recorded.".into(),
        );
    }

    let Some(saved_credential) = saved_credentials.get(last_user_logged_in) else {
        return (
            SavedAuthAutoLoginStatus::MissingLastUser,
            "The last logged-in account is no longer present in saved credentials.".into(),
        );
    };

    if !saved_credential.has_login_credentials() {
        return (
            SavedAuthAutoLoginStatus::MissingCredentials,
            "The saved account is missing username or password data.".into(),
        );
    }

    if auto_login_delay_enabled && auto_login_delay_seconds > 0 {
        return (
            SavedAuthAutoLoginStatus::Available,
            format!(
                "Saved credentials are available. Auto-login delay is {auto_login_delay_seconds} second(s)."
            ),
        );
    }

    (
        SavedAuthAutoLoginStatus::Available,
        "Saved credentials are available and auto-login can run immediately.".into(),
    )
}

fn saved_credential_sort_name(value: &SavedCredential) -> String {
    value
        .user
        .display_name
        .as_deref()
        .filter(|display_name| !display_name.trim().is_empty())
        .or(value.user.username.as_deref())
        .unwrap_or_default()
        .trim()
        .to_lowercase()
}

fn sorted_redacted_saved_credentials_list(
    saved_credentials: &SavedCredentials,
    last_user_logged_in: &str,
) -> Vec<SavedCredentialSnapshot> {
    let mut values = saved_credentials.values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        let left_is_last = !last_user_logged_in.is_empty() && left.user.id == last_user_logged_in;
        let right_is_last = !last_user_logged_in.is_empty() && right.user.id == last_user_logged_in;
        if left_is_last != right_is_last {
            return right_is_last.cmp(&left_is_last);
        }
        saved_credential_sort_name(left).cmp(&saved_credential_sort_name(right))
    });
    values.into_iter().map(SavedCredential::redacted).collect()
}

pub(super) fn build_saved_auth_snapshot(config: &ConfigRepository) -> Result<SavedAuthSnapshot> {
    let mut saved_credentials = read_saved_credentials(config)?;
    let mut last_user_logged_in = get_config_string(config, LAST_USER_LOGGED_IN_KEY, "")?;
    let legacy_primary_password_enabled =
        get_config_bool(config, LEGACY_PRIMARY_PASSWORD_KEY, false)?;
    if legacy_primary_password_enabled {
        saved_credentials.clear();
        last_user_logged_in.clear();
        write_saved_credentials(config, &saved_credentials)?;
        remove_config_value(config, LEGACY_PRIMARY_PASSWORD_KEY)?;
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }

    let auto_login_delay_enabled = get_config_bool(config, AUTO_LOGIN_DELAY_ENABLED_KEY, false)?;
    let auto_login_delay_seconds = normalize_auto_login_delay_seconds(&get_config_string(
        config,
        AUTO_LOGIN_DELAY_SECONDS_KEY,
        "0",
    )?);
    let (auto_login_status, auto_login_reason) = resolve_auto_login_status(
        &last_user_logged_in,
        &saved_credentials,
        auto_login_delay_enabled,
        auto_login_delay_seconds,
    );
    let saved_credentials_list =
        sorted_redacted_saved_credentials_list(&saved_credentials, &last_user_logged_in);

    Ok(SavedAuthSnapshot {
        last_user_logged_in: (!last_user_logged_in.is_empty()).then_some(last_user_logged_in),
        saved_credentials_list,
        auto_login_delay_enabled,
        auto_login_delay_seconds,
        auto_login_status,
        auto_login_reason,
    })
}
