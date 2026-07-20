use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::secrets;

use super::compat::{
    normalize_text, saved_credential_user_from_value, saved_login_params_from_value,
    value_as_string,
};
use super::types::{SavedCredential, SavedCredentialSessionData, SavedCredentials};
use crate::{Error, Result};

pub(super) const SAVED_CREDENTIALS_KEY: &str = "savedCredentials";
pub(super) const LAST_USER_LOGGED_IN_KEY: &str = "lastUserLoggedIn";
const PASSWORD_STORAGE_KEY: &str = "passwordStorage";
const PLAINTEXT_PASSWORD_STORAGE: &str = "plain";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedLoginParams {
    username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    endpoint: String,
    websocket: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    password_storage: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSavedCredential<'a> {
    user: &'a super::types::SavedCredentialUser,
    login_params: PersistedLoginParams,
    #[serde(skip_serializing_if = "Option::is_none")]
    cookies: Option<String>,
}

pub fn saved_credential_session_data(
    config: &ConfigRepository,
    user_id: &str,
) -> Result<Option<SavedCredentialSessionData>> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    let saved_credentials = read_saved_credentials(config)?;
    Ok(saved_credentials
        .get(&user_id)
        .map(|record| SavedCredentialSessionData {
            endpoint: record.login_params.endpoint.clone(),
            websocket: record.login_params.websocket.clone(),
            cookies: record.cookies.clone(),
        }))
}

pub fn migrate_saved_credential_secrets(config: &ConfigRepository) -> Result<bool> {
    if !secrets::is_encrypting_writes() {
        return Ok(false);
    }
    let Some(raw) = config.get_raw(SAVED_CREDENTIALS_KEY)? else {
        return Ok(false);
    };
    let source = serde_json::from_str::<Value>(&raw).ok();
    if source
        .as_ref()
        .is_some_and(|value| !saved_credentials_need_migration(value))
    {
        return Ok(false);
    }
    config.remove(secrets::CLEANUP_COMPLETED_CONFIG_KEY)?;
    let saved_credentials = read_saved_credentials(config)?;
    write_saved_credentials(config, &saved_credentials)?;
    let persisted = config.get_raw(SAVED_CREDENTIALS_KEY)?;
    let migrated = persisted
        .as_deref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .is_some_and(|value| !saved_credentials_need_migration(&value));
    if !migrated {
        return Err(Error::Custom(
            "saved credential secret migration did not produce encrypted storage".into(),
        ));
    }
    Ok(true)
}

fn decode_secret(stored: String, field: &str) -> (Option<String>, bool) {
    if stored.is_empty() {
        return (None, false);
    }
    match secrets::open_secret(&stored) {
        Some(plaintext) => (Some(plaintext), false),
        None => {
            tracing::info!(
                field,
                "stored credential secret is not decryptable; clearing it"
            );
            (None, true)
        }
    }
}

fn decode_saved_credential(key: &str, entry: &Value) -> (bool, Option<(String, SavedCredential)>) {
    let Some(record) = entry.as_object() else {
        return (true, None);
    };
    let Some(user_value) = record.get("user") else {
        return (true, None);
    };
    let Some(user) = saved_credential_user_from_value(user_value, key) else {
        return (true, None);
    };

    let raw_login_params = record
        .get("loginParams")
        .or_else(|| record.get("loginParmas"))
        .unwrap_or(&Value::Null);
    let mut login_params = saved_login_params_from_value(raw_login_params);
    let password_is_marked_plaintext = raw_login_params
        .get(PASSWORD_STORAGE_KEY)
        .and_then(Value::as_str)
        == Some(PLAINTEXT_PASSWORD_STORAGE);

    let mut edited = user.id != key
        || record.contains_key("loginParmas")
        || !raw_login_params
            .as_object()
            .is_some_and(|params| params.contains_key("endpoint"))
        || !raw_login_params
            .as_object()
            .is_some_and(|params| params.contains_key("websocket"))
        || !value_as_string(raw_login_params.get("endpoint")).is_empty()
        || !value_as_string(raw_login_params.get("websocket")).is_empty();

    if password_is_marked_plaintext {
        edited |= secrets::is_encrypting_writes();
    } else {
        if let Some(stored_password) = login_params.password.take() {
            let (password, password_edited) =
                decode_secret(stored_password, "loginParams.password");
            login_params.password = password;
            edited |= password_edited;
        }
    }

    let cookies = match record.get("cookies") {
        Some(Value::String(value)) => {
            let (cookies, cookies_edited) = decode_secret(value.clone(), "cookies");
            edited |= cookies_edited;
            cookies
        }
        Some(Value::Null) | None => None,
        Some(_) => {
            edited = true;
            None
        }
    };

    let user_id = user.id.clone();
    (
        edited,
        Some((
            user_id,
            SavedCredential {
                user,
                login_params,
                cookies,
            },
        )),
    )
}

fn seal_secret(plaintext: &str) -> (String, bool) {
    if plaintext.is_empty() {
        return (String::new(), false);
    }
    let (stored, encrypted) = secrets::seal_secret_with_status(plaintext);
    (stored, secrets::is_initialized() && !encrypted)
}

fn persisted_saved_credentials<'a>(
    saved_credentials: &'a SavedCredentials,
) -> (BTreeMap<String, PersistedSavedCredential<'a>>, bool) {
    let mut persisted = BTreeMap::new();
    let mut contains_plaintext_secret = false;
    for (user_id, credential) in saved_credentials {
        let (password, password_is_plaintext) =
            credential.login_params.password.as_deref().map_or_else(
                || (None, false),
                |password| {
                    let (stored, plaintext) = seal_secret(password);
                    (Some(stored), plaintext)
                },
            );
        let (cookies, cookies_are_plaintext) = credential.cookies.as_deref().map_or_else(
            || (None, false),
            |cookies| {
                let (stored, plaintext) = seal_secret(cookies);
                (
                    if stored.is_empty() {
                        None
                    } else {
                        Some(stored)
                    },
                    plaintext,
                )
            },
        );
        contains_plaintext_secret |= password_is_plaintext || cookies_are_plaintext;
        persisted.insert(
            user_id.clone(),
            PersistedSavedCredential {
                user: &credential.user,
                login_params: PersistedLoginParams {
                    username: credential.login_params.username.clone(),
                    password,
                    endpoint: credential.login_params.endpoint.clone(),
                    websocket: credential.login_params.websocket.clone(),
                    password_storage: password_is_plaintext.then_some(PLAINTEXT_PASSWORD_STORAGE),
                },
                cookies,
            },
        );
    }
    (persisted, contains_plaintext_secret)
}

fn secret_value_needs_migration(value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(value)) => !value.is_empty() && !secrets::is_sealed_secret(value),
        Some(Value::Null) | None => false,
        Some(_) => true,
    }
}

fn saved_password_needs_migration(login_params: &serde_json::Map<String, Value>) -> bool {
    let password = login_params.get("password");
    let marked_plaintext = login_params
        .get(PASSWORD_STORAGE_KEY)
        .and_then(Value::as_str)
        == Some(PLAINTEXT_PASSWORD_STORAGE);
    let non_empty_password = password
        .and_then(Value::as_str)
        .is_some_and(|password| !password.is_empty());
    (marked_plaintext && non_empty_password) || secret_value_needs_migration(password)
}

fn saved_credentials_need_migration(value: &Value) -> bool {
    let Some(saved_credentials) = value.as_object() else {
        return true;
    };
    saved_credentials.values().any(|value| {
        let Some(record) = value.as_object() else {
            return false;
        };
        secret_value_needs_migration(record.get("cookies"))
            || ["loginParams", "loginParmas"].iter().any(|key| {
                record
                    .get(*key)
                    .and_then(Value::as_object)
                    .is_some_and(saved_password_needs_migration)
            })
    })
}

pub(super) fn read_saved_credentials(config: &ConfigRepository) -> Result<SavedCredentials> {
    let source = config
        .get_raw(SAVED_CREDENTIALS_KEY)?
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| Value::Object(Default::default()));
    let source_object = source.as_object().cloned().unwrap_or_default();

    let mut normalized = SavedCredentials::new();
    let mut edited = !source.is_object();
    for (key, value) in &source_object {
        let (entry_edited, normalized_entry) = decode_saved_credential(key, value);
        if let Some((normalized_key, normalized_value)) = normalized_entry {
            normalized.insert(normalized_key, normalized_value);
        }
        edited |= entry_edited;
    }

    if edited {
        write_saved_credentials(config, &normalized)?;
    }
    Ok(normalized)
}

pub(super) fn write_saved_credentials(
    config: &ConfigRepository,
    saved_credentials: &SavedCredentials,
) -> Result<()> {
    let (persisted, contains_plaintext_secret) = persisted_saved_credentials(saved_credentials);
    if contains_plaintext_secret {
        config.remove(secrets::CLEANUP_COMPLETED_CONFIG_KEY)?;
    }
    config.set_string(SAVED_CREDENTIALS_KEY, &serde_json::to_string(&persisted)?)?;
    Ok(())
}

pub(super) fn get_config_string(
    config: &ConfigRepository,
    key: &str,
    default_value: &str,
) -> Result<String> {
    Ok(config.get_string(key, default_value)?)
}

pub(super) fn get_config_bool(
    config: &ConfigRepository,
    key: &str,
    default_value: bool,
) -> Result<bool> {
    Ok(config.get_bool(key, default_value)?)
}

pub(super) fn remove_config_value(config: &ConfigRepository, key: &str) -> Result<()> {
    Ok(config.remove(key)?)
}

pub(super) fn set_config_string(config: &ConfigRepository, key: &str, value: &str) -> Result<()> {
    Ok(config.set_string(key, value)?)
}
