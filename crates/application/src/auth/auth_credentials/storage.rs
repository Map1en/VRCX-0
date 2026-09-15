use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use super::compat::{
    normalize_text, saved_credential_user_from_value, saved_login_params_from_value,
    value_as_string,
};
use super::types::{SavedCredential, SavedCredentialSessionData, SavedCredentials};
use vrcx_0_application_core::{Error, Result};

pub(super) const SAVED_CREDENTIALS_KEY: &str = "savedCredentials";
pub(super) const LAST_USER_LOGGED_IN_KEY: &str = "lastUserLoggedIn";
const PASSWORD_STORAGE_KEY: &str = "passwordStorage";
const PLAINTEXT_PASSWORD_STORAGE: &str = "plain";
const SECRETS_CLEANUP_COMPLETED_CONFIG_KEY: &str = "secretsAtRestCleanupCompletedV1";

pub struct SealedAuthSecret {
    pub stored: String,
    pub encrypted: bool,
}

pub trait AuthCredentialStore: Send + Sync {
    fn get_raw(&self, key: &str) -> Result<Option<String>>;
    fn get_string(&self, key: &str, default_value: &str) -> Result<String>;
    fn get_bool(&self, key: &str, default_value: bool) -> Result<bool>;
    fn set_string(&self, key: &str, value: &str) -> Result<()>;
    fn remove(&self, key: &str) -> Result<()>;
    fn is_encrypting_writes(&self) -> bool;
    fn is_secret_store_initialized(&self) -> bool;
    fn open_secret(&self, stored: &str) -> Option<String>;
    fn seal_secret(&self, plaintext: &str) -> SealedAuthSecret;
    fn is_sealed_secret(&self, value: &str) -> bool;
}

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
    config: &dyn AuthCredentialStore,
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

pub(crate) fn saved_credential_password(
    config: &dyn AuthCredentialStore,
    user_id: &str,
) -> Result<Option<String>> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    let saved_credentials = read_saved_credentials(config)?;
    Ok(saved_credentials
        .get(&user_id)
        .and_then(|record| record.login_params.password.clone()))
}

pub fn migrate_saved_credential_secrets(config: &dyn AuthCredentialStore) -> Result<bool> {
    if !config.is_encrypting_writes() {
        return Ok(false);
    }
    let Some(raw) = config.get_raw(SAVED_CREDENTIALS_KEY)? else {
        return Ok(false);
    };
    let source = serde_json::from_str::<Value>(&raw).ok();
    if source
        .as_ref()
        .is_some_and(|value| !saved_credentials_need_migration(config, value))
    {
        return Ok(false);
    }
    config.remove(SECRETS_CLEANUP_COMPLETED_CONFIG_KEY)?;
    let saved_credentials = read_saved_credentials(config)?;
    write_saved_credentials(config, &saved_credentials)?;
    let persisted = config.get_raw(SAVED_CREDENTIALS_KEY)?;
    let migrated = persisted
        .as_deref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .is_some_and(|value| !saved_credentials_need_migration(config, &value));
    if !migrated {
        return Err(Error::Custom(
            "saved credential secret migration did not produce encrypted storage".into(),
        ));
    }
    Ok(true)
}

struct DecodedSecret {
    plaintext: Option<String>,
    cleared_as_undecryptable: bool,
}

struct DecodedSavedCredential {
    needs_rewrite: bool,
    entry: Option<DecodedSavedCredentialEntry>,
}

struct DecodedSavedCredentialEntry {
    user_id: String,
    credential: SavedCredential,
}

impl DecodedSavedCredential {
    fn unusable() -> Self {
        Self {
            needs_rewrite: true,
            entry: None,
        }
    }
}

fn decode_secret(config: &dyn AuthCredentialStore, stored: String, field: &str) -> DecodedSecret {
    if stored.is_empty() {
        return DecodedSecret {
            plaintext: None,
            cleared_as_undecryptable: false,
        };
    }
    match config.open_secret(&stored) {
        Some(plaintext) => DecodedSecret {
            plaintext: Some(plaintext),
            cleared_as_undecryptable: false,
        },
        None => {
            tracing::info!(
                field,
                "stored credential secret is not decryptable; clearing it"
            );
            DecodedSecret {
                plaintext: None,
                cleared_as_undecryptable: true,
            }
        }
    }
}

fn decode_saved_credential(
    config: &dyn AuthCredentialStore,
    key: &str,
    entry: &Value,
) -> DecodedSavedCredential {
    let Some(record) = entry.as_object() else {
        return DecodedSavedCredential::unusable();
    };
    let Some(user_value) = record.get("user") else {
        return DecodedSavedCredential::unusable();
    };
    let Some(user) = saved_credential_user_from_value(user_value, key) else {
        return DecodedSavedCredential::unusable();
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
        edited |= config.is_encrypting_writes();
    } else {
        if let Some(stored_password) = login_params.password.take() {
            let decoded = decode_secret(config, stored_password, "loginParams.password");
            login_params.password = decoded.plaintext;
            edited |= decoded.cleared_as_undecryptable;
        }
    }

    let cookies = match record.get("cookies") {
        Some(Value::String(value)) => {
            let decoded = decode_secret(config, value.clone(), "cookies");
            edited |= decoded.cleared_as_undecryptable;
            decoded.plaintext
        }
        Some(Value::Null) | None => None,
        Some(_) => {
            edited = true;
            None
        }
    };

    let user_id = user.id.clone();
    DecodedSavedCredential {
        needs_rewrite: edited,
        entry: Some(DecodedSavedCredentialEntry {
            user_id,
            credential: SavedCredential {
                user,
                login_params,
                cookies,
            },
        }),
    }
}

struct SealedCredentialSecret {
    stored: String,
    is_plaintext: bool,
}

fn seal_secret(config: &dyn AuthCredentialStore, plaintext: &str) -> SealedCredentialSecret {
    if plaintext.is_empty() {
        return SealedCredentialSecret {
            stored: String::new(),
            is_plaintext: false,
        };
    }
    let sealed = config.seal_secret(plaintext);
    SealedCredentialSecret {
        stored: sealed.stored,
        is_plaintext: config.is_secret_store_initialized() && !sealed.encrypted,
    }
}

fn persisted_saved_credentials<'a>(
    config: &dyn AuthCredentialStore,
    saved_credentials: &'a SavedCredentials,
) -> (BTreeMap<String, PersistedSavedCredential<'a>>, bool) {
    let mut persisted = BTreeMap::new();
    let mut contains_plaintext_secret = false;
    for (user_id, credential) in saved_credentials {
        let (password, password_is_plaintext) =
            credential.login_params.password.as_deref().map_or_else(
                || (None, false),
                |password| {
                    let sealed = seal_secret(config, password);
                    (Some(sealed.stored), sealed.is_plaintext)
                },
            );
        let (cookies, cookies_are_plaintext) = credential.cookies.as_deref().map_or_else(
            || (None, false),
            |cookies| {
                let sealed = seal_secret(config, cookies);
                (
                    if sealed.stored.is_empty() {
                        None
                    } else {
                        Some(sealed.stored)
                    },
                    sealed.is_plaintext,
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

fn secret_value_needs_migration(config: &dyn AuthCredentialStore, value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(value)) => !value.is_empty() && !config.is_sealed_secret(value),
        Some(Value::Null) | None => false,
        Some(_) => true,
    }
}

fn saved_password_needs_migration(
    config: &dyn AuthCredentialStore,
    login_params: &serde_json::Map<String, Value>,
) -> bool {
    let password = login_params.get("password");
    let marked_plaintext = login_params
        .get(PASSWORD_STORAGE_KEY)
        .and_then(Value::as_str)
        == Some(PLAINTEXT_PASSWORD_STORAGE);
    let non_empty_password = password
        .and_then(Value::as_str)
        .is_some_and(|password| !password.is_empty());
    (marked_plaintext && non_empty_password) || secret_value_needs_migration(config, password)
}

fn saved_credentials_need_migration(config: &dyn AuthCredentialStore, value: &Value) -> bool {
    let Some(saved_credentials) = value.as_object() else {
        return true;
    };
    saved_credentials.values().any(|value| {
        let Some(record) = value.as_object() else {
            return false;
        };
        secret_value_needs_migration(config, record.get("cookies"))
            || ["loginParams", "loginParmas"].iter().any(|key| {
                record
                    .get(*key)
                    .and_then(Value::as_object)
                    .is_some_and(|params| saved_password_needs_migration(config, params))
            })
    })
}

pub(super) fn read_saved_credentials(config: &dyn AuthCredentialStore) -> Result<SavedCredentials> {
    let source = config
        .get_raw(SAVED_CREDENTIALS_KEY)?
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| Value::Object(Default::default()));
    let source_object = source.as_object().cloned().unwrap_or_default();

    let mut normalized = SavedCredentials::new();
    let mut edited = !source.is_object();
    for (key, value) in &source_object {
        let decoded = decode_saved_credential(config, key, value);
        if let Some(entry) = decoded.entry {
            normalized.insert(entry.user_id, entry.credential);
        }
        edited |= decoded.needs_rewrite;
    }

    if edited {
        write_saved_credentials(config, &normalized)?;
    }
    Ok(normalized)
}

pub(super) fn write_saved_credentials(
    config: &dyn AuthCredentialStore,
    saved_credentials: &SavedCredentials,
) -> Result<()> {
    let (persisted, contains_plaintext_secret) =
        persisted_saved_credentials(config, saved_credentials);
    if contains_plaintext_secret {
        config.remove(SECRETS_CLEANUP_COMPLETED_CONFIG_KEY)?;
    }
    config.set_string(SAVED_CREDENTIALS_KEY, &serde_json::to_string(&persisted)?)?;
    Ok(())
}

pub(super) fn get_config_string(
    config: &dyn AuthCredentialStore,
    key: &str,
    default_value: &str,
) -> Result<String> {
    config.get_string(key, default_value)
}

pub(super) fn get_config_bool(
    config: &dyn AuthCredentialStore,
    key: &str,
    default_value: bool,
) -> Result<bool> {
    config.get_bool(key, default_value)
}

pub(super) fn remove_config_value(config: &dyn AuthCredentialStore, key: &str) -> Result<()> {
    config.remove(key)
}

pub(super) fn set_config_string(
    config: &dyn AuthCredentialStore,
    key: &str,
    value: &str,
) -> Result<()> {
    config.set_string(key, value)
}
