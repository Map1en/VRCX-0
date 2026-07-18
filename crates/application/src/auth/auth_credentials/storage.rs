use serde_json::{json, Map, Value};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::secrets;

use super::types::SavedCredentialSessionData;
use crate::{Error, Result};

pub(super) const SAVED_CREDENTIALS_KEY: &str = "savedCredentials";
pub(super) const LAST_USER_LOGGED_IN_KEY: &str = "lastUserLoggedIn";
const PASSWORD_STORAGE_KEY: &str = "passwordStorage";
const PLAINTEXT_PASSWORD_STORAGE: &str = "plain";

pub fn saved_credential_session_data(
    config: &ConfigRepository,
    user_id: &str,
) -> Result<Option<SavedCredentialSessionData>> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    let saved_credentials = read_saved_credentials_map(config)?;
    let Some(record) = saved_credentials.get(&user_id).and_then(Value::as_object) else {
        return Ok(None);
    };
    let login_params = record.get("loginParams").unwrap_or(&Value::Null);
    let cookies = record
        .get("cookies")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string);
    Ok(Some(SavedCredentialSessionData {
        endpoint: object_field_string(login_params, "endpoint"),
        websocket: object_field_string(login_params, "websocket"),
        cookies,
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
    let saved_credentials = read_saved_credentials_map(config)?;
    write_saved_credentials_map(config, &saved_credentials)?;
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

pub(super) fn normalize_login_params_value(raw_login_params: &Value) -> Value {
    let mut normalized = Map::new();
    normalized.insert(
        "username".into(),
        Value::String(object_field_raw_string(raw_login_params, "username")),
    );
    normalized.insert(
        "password".into(),
        Value::String(object_field_raw_string(raw_login_params, "password")),
    );
    normalized.insert("endpoint".into(), Value::String(String::new()));
    normalized.insert("websocket".into(), Value::String(String::new()));
    if raw_login_params
        .get(PASSWORD_STORAGE_KEY)
        .and_then(Value::as_str)
        == Some(PLAINTEXT_PASSWORD_STORAGE)
    {
        normalized.insert(
            PASSWORD_STORAGE_KEY.into(),
            Value::String(PLAINTEXT_PASSWORD_STORAGE.into()),
        );
    }
    Value::Object(normalized)
}

fn normalize_login_params_record(record: &Value) -> Value {
    let raw_login_params = record
        .as_object()
        .and_then(|object| {
            object
                .get("loginParams")
                .or_else(|| object.get("loginParmas"))
        })
        .unwrap_or(&Value::Null);
    normalize_login_params_value(raw_login_params)
}

fn normalize_saved_credential_record(key: &str, entry: &Value) -> (bool, Option<(String, Value)>) {
    let Some(record) = entry.as_object() else {
        return (false, None);
    };
    let Some(user) = record.get("user").filter(|value| value.is_object()) else {
        return (false, None);
    };

    let user_id = object_field_string(user, "id");
    let user_id = if user_id.is_empty() {
        key.trim().to_string()
    } else {
        user_id
    };
    if user_id.is_empty() {
        return (false, None);
    }

    let mut normalized = Map::new();
    normalized.insert("user".into(), user.clone());
    normalized.insert("loginParams".into(), normalize_login_params_record(entry));
    if let Some(cookies) = record.get("cookies") {
        let has_cookies = match cookies {
            Value::Null => false,
            Value::String(value) => !value.is_empty(),
            _ => true,
        };
        if has_cookies {
            normalized.insert("cookies".into(), cookies.clone());
        }
    }

    let raw_login_params = record
        .get("loginParams")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let edited = user_id != key
        || record.contains_key("loginParmas")
        || !raw_login_params.contains_key("endpoint")
        || !raw_login_params.contains_key("websocket")
        || !value_as_string(raw_login_params.get("endpoint")).is_empty()
        || !value_as_string(raw_login_params.get("websocket")).is_empty();

    (edited, Some((user_id, Value::Object(normalized))))
}

fn open_secret_field(object: &mut Map<String, Value>, key: &str, field: &str) -> bool {
    let Some(value) = object.get(key) else {
        return false;
    };
    let Value::String(stored) = value else {
        object.remove(key);
        return true;
    };
    if stored.is_empty() {
        return false;
    }
    let stored = stored.clone();
    match secrets::open_secret(&stored) {
        Some(plaintext) => {
            object.insert(key.into(), Value::String(plaintext));
            false
        }
        None => {
            object.remove(key);
            tracing::info!(
                field,
                "stored credential secret is not decryptable; clearing it"
            );
            true
        }
    }
}

fn open_saved_credential_secrets(value: &mut Value) -> bool {
    let Some(record) = value.as_object_mut() else {
        return false;
    };
    let mut edited = open_secret_field(record, "cookies", "cookies");
    if let Some(login_params) = record.get_mut("loginParams").and_then(Value::as_object_mut) {
        let password_is_marked_plaintext = matches!(
            login_params.remove(PASSWORD_STORAGE_KEY),
            Some(Value::String(storage)) if storage == PLAINTEXT_PASSWORD_STORAGE
        );
        if !password_is_marked_plaintext {
            edited = open_secret_field(login_params, "password", "loginParams.password") || edited;
        } else if secrets::is_encrypting_writes() {
            edited = true;
        }
    }
    edited
}

fn seal_secret_field(object: &mut Map<String, Value>, key: &str) -> bool {
    let Some(value) = object.get(key) else {
        return false;
    };
    let Value::String(plaintext) = value else {
        object.remove(key);
        return false;
    };
    if plaintext.is_empty() {
        return false;
    }
    let plaintext = plaintext.clone();
    let (stored, encrypted) = secrets::seal_secret_with_status(&plaintext);
    object.insert(key.into(), Value::String(stored));
    secrets::is_initialized() && !encrypted
}

fn seal_saved_credential_secrets(
    saved_credentials: &Map<String, Value>,
) -> (Map<String, Value>, bool) {
    let mut sealed = saved_credentials.clone();
    let mut contains_plaintext_secret = false;
    for value in sealed.values_mut() {
        let Some(record) = value.as_object_mut() else {
            continue;
        };
        contains_plaintext_secret |= seal_secret_field(record, "cookies");
        if let Some(login_params) = record.get_mut("loginParams").and_then(Value::as_object_mut) {
            login_params.remove(PASSWORD_STORAGE_KEY);
            let plaintext = login_params
                .get("password")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            if let Some(plaintext) = plaintext {
                let (stored, encrypted) = secrets::seal_secret_with_status(&plaintext);
                let stored_as_plaintext = secrets::is_initialized() && !encrypted;
                login_params.insert("password".into(), Value::String(stored));
                if stored_as_plaintext {
                    contains_plaintext_secret = true;
                    login_params.insert(
                        PASSWORD_STORAGE_KEY.into(),
                        Value::String(PLAINTEXT_PASSWORD_STORAGE.into()),
                    );
                }
            }
        }
    }
    (sealed, contains_plaintext_secret)
}

fn secret_value_needs_migration(value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(value)) => !value.is_empty() && !secrets::is_sealed_secret(value),
        Some(Value::Null) | None => false,
        Some(_) => true,
    }
}

fn saved_password_needs_migration(login_params: &Map<String, Value>) -> bool {
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

pub(super) fn read_saved_credentials_map(config: &ConfigRepository) -> Result<Map<String, Value>> {
    let source = config.get_json(SAVED_CREDENTIALS_KEY, json!({}))?;
    let source_object = source.as_object().cloned().unwrap_or_default();

    let mut normalized = Map::new();
    let mut edited = false;
    for (key, value) in &source_object {
        let (entry_edited, normalized_entry) = normalize_saved_credential_record(key, value);
        match normalized_entry {
            Some((normalized_key, mut normalized_value)) => {
                let secrets_edited = open_saved_credential_secrets(&mut normalized_value);
                normalized.insert(normalized_key, normalized_value);
                edited = edited || entry_edited || secrets_edited;
            }
            None => edited = true,
        }
    }

    if edited {
        write_saved_credentials_map(config, &normalized)?;
    }
    Ok(normalized)
}

pub(super) fn write_saved_credentials_map(
    config: &ConfigRepository,
    saved_credentials: &Map<String, Value>,
) -> Result<()> {
    let (sealed, contains_plaintext_secret) = seal_saved_credential_secrets(saved_credentials);
    if contains_plaintext_secret {
        config.remove(secrets::CLEANUP_COMPLETED_CONFIG_KEY)?;
    }
    let value = Value::Object(sealed);
    config.set_string(SAVED_CREDENTIALS_KEY, &value.to_string())?;
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

pub(super) fn value_as_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn value_as_raw_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

pub(super) fn object_field_string(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(|value| value_as_string(Some(value)))
        .unwrap_or_default()
}

pub(super) fn object_field_raw_string(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(|value| value_as_raw_string(Some(value)))
        .unwrap_or_default()
}

pub(super) fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}
