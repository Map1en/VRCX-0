use std::path::PathBuf;

use serde_json::{json, Value};

use vrcx_0_integrations::external_api;
use vrcx_0_persistence::config::{get_json, resolve_config_key, set_json, ConfigWriteEntry};
use vrcx_0_persistence::DatabaseService;

use crate::{
    Error, Result, PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY,
    PROFILE_BACKUP_DIRECTORY_CONFIG_KEY, PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY,
    PROFILE_BACKUP_INTERVAL_DAYS_MAX, PROFILE_BACKUP_INTERVAL_DAYS_MIN,
    PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY, PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY,
    PROFILE_BACKUP_RETENTION_COUNT_MAX, PROFILE_BACKUP_RETENTION_COUNT_MIN,
};

pub fn read_config_string_array(db: &DatabaseService, key: &str) -> Result<Vec<String>> {
    let parsed = get_json(db, key, Value::Null)?;
    let mut values = parsed
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(config_value_to_string)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    values.sort();
    values.dedup();
    Ok(values)
}

pub fn write_config_string_array(db: &DatabaseService, key: &str, values: &[String]) -> Result<()> {
    set_json(db, key, &json!(values))?;
    Ok(())
}

fn config_value_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

pub fn validate_config_writes(entries: &[ConfigWriteEntry]) -> Result<()> {
    for entry in entries {
        validate_config_write(&entry.key, &entry.value)?;
    }
    Ok(())
}

fn validate_config_write(key: &str, value: &str) -> Result<()> {
    match resolve_config_key(key).as_str() {
        "config:vrcx_usergeneratedcontentpath" => validate_ugc_path(value),
        key if key == resolve_config_key(PROFILE_BACKUP_DIRECTORY_CONFIG_KEY) => {
            validate_optional_directory_path(value, PROFILE_BACKUP_DIRECTORY_CONFIG_KEY)
        }
        key if key == resolve_config_key(PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY) => {
            validate_bool(value, PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY)
        }
        key if key == resolve_config_key(PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY) => {
            validate_bounded_integer(
                value,
                PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY,
                u64::from(PROFILE_BACKUP_INTERVAL_DAYS_MIN),
                u64::from(PROFILE_BACKUP_INTERVAL_DAYS_MAX),
            )
        }
        key if key == resolve_config_key(PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY) => {
            validate_bounded_integer(
                value,
                PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY,
                PROFILE_BACKUP_RETENTION_COUNT_MIN as u64,
                PROFILE_BACKUP_RETENTION_COUNT_MAX as u64,
            )
        }
        key if key == resolve_config_key(PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY) => {
            validate_optional_timestamp(value, PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY)
        }
        "config:vrcx_translationapiendpoint" => validate_optional_provider_url(
            value,
            "translationAPIEndpoint must be an HTTP or HTTPS endpoint.",
        ),
        "config:vrcx_avatarremotedatabaseprovider" => validate_optional_provider_url(
            value,
            "VRCX_avatarRemoteDatabaseProvider must be an HTTP or HTTPS endpoint.",
        ),
        "config:vrcx_avatarremotedatabaseproviderlist" => validate_provider_list(value),
        _ => Ok(()),
    }
}

fn validate_bool(value: &str, setting_name: &str) -> Result<()> {
    if matches!(value.trim(), "true" | "false") {
        return Ok(());
    }
    Err(Error::Custom(format!(
        "{setting_name} must be true or false."
    )))
}

fn validate_bounded_integer(value: &str, setting_name: &str, min: u64, max: u64) -> Result<()> {
    if value
        .trim()
        .parse::<u64>()
        .is_ok_and(|value| (min..=max).contains(&value))
    {
        return Ok(());
    }
    Err(Error::Custom(format!(
        "{setting_name} must be an integer from {min} to {max}."
    )))
}

fn validate_optional_timestamp(value: &str, setting_name: &str) -> Result<()> {
    let value = value.trim();
    if value.is_empty() || value.parse::<chrono::DateTime<chrono::Utc>>().is_ok() {
        return Ok(());
    }
    Err(Error::Custom(format!(
        "{setting_name} must be an RFC 3339 timestamp."
    )))
}

fn validate_ugc_path(value: &str) -> Result<()> {
    validate_optional_directory_path(value, "userGeneratedContentPath")
}

fn validate_optional_directory_path(value: &str, setting_name: &str) -> Result<()> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(Error::Custom(format!(
            "{setting_name} must be an absolute folder path."
        )));
    }
    if path.exists() && !path.is_dir() {
        return Err(Error::Custom(format!(
            "{setting_name} must point to a folder."
        )));
    }
    Ok(())
}

fn validate_optional_provider_url(value: &str, message: &str) -> Result<()> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }
    if external_api::request_origin(value).is_some() {
        return Ok(());
    }
    Err(Error::Custom(message.into()))
}

fn validate_provider_list(value: &str) -> Result<()> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }
    let providers: Vec<String> = serde_json::from_str(value).map_err(|error| {
        Error::Custom(format!(
            "VRCX_avatarRemoteDatabaseProviderList must be a JSON string array: {error}"
        ))
    })?;
    for provider in providers {
        validate_optional_provider_url(
            &provider,
            "VRCX_avatarRemoteDatabaseProviderList contains a non-HTTP(S) endpoint.",
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(key: &str, value: &str) -> ConfigWriteEntry {
        ConfigWriteEntry {
            key: key.into(),
            value: value.into(),
        }
    }

    #[test]
    fn accepts_regular_config_and_http_providers() {
        validate_config_writes(&[
            entry("SomeRegularSetting", "anything"),
            entry(
                "translationAPIEndpoint",
                "http://localhost:8123/v1/chat/completions",
            ),
            entry(
                "VRCX_avatarRemoteDatabaseProviderList",
                r#"["http://127.0.0.1:8123/api","https://10.0.0.5/api"]"#,
            ),
        ])
        .unwrap();
    }

    #[test]
    fn rejects_non_http_provider_config() {
        assert!(validate_config_writes(&[entry(
            "translationAPIEndpoint",
            "ftp://example.com/api"
        )])
        .is_err());
        assert!(validate_config_writes(&[entry(
            "VRCX_avatarRemoteDatabaseProvider",
            "file:///tmp/provider.json"
        )])
        .is_err());
    }

    #[test]
    fn rejects_relative_ugc_config_paths() {
        assert!(
            validate_config_writes(&[entry("userGeneratedContentPath", "relative/path")]).is_err()
        );
    }

    #[test]
    fn validates_profile_backup_directory_paths() {
        assert!(validate_config_writes(&[entry(PROFILE_BACKUP_DIRECTORY_CONFIG_KEY, "")]).is_ok());
        assert!(validate_config_writes(&[entry(
            PROFILE_BACKUP_DIRECTORY_CONFIG_KEY,
            &std::env::temp_dir().to_string_lossy()
        )])
        .is_ok());
        assert!(validate_config_writes(&[entry(
            PROFILE_BACKUP_DIRECTORY_CONFIG_KEY,
            "relative/backup"
        )])
        .is_err());
    }

    #[test]
    fn validates_automatic_profile_backup_settings() {
        assert!(validate_config_writes(&[
            entry(PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY, "true"),
            entry(PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY, "7"),
            entry(PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY, "3"),
            entry(
                PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY,
                "2026-07-13T15:30:00Z"
            ),
        ])
        .is_ok());
        assert!(
            validate_config_writes(&[entry(PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY, "31")])
                .is_err()
        );
        assert!(
            validate_config_writes(&[entry(PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY, "0")])
                .is_err()
        );
        assert!(validate_config_writes(&[entry(
            PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY,
            "sometimes"
        )])
        .is_err());
    }
}
