use std::path::PathBuf;

use serde_json::{json, Value};

use vrcx_0_integrations::external_api;
use vrcx_0_persistence::config::{get_json, resolve_config_key, set_json, ConfigWriteEntry};
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result};

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
        "config:vrcx_savedcredentials" => Err(Error::Custom(
            "savedCredentials must be changed through the dedicated auth service.".into(),
        )),
        "config:vrcx_usergeneratedcontentpath" => validate_ugc_path(value),
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

fn validate_ugc_path(value: &str) -> Result<()> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(Error::Custom(
            "userGeneratedContentPath must be an absolute folder path.".into(),
        ));
    }
    if path.exists() && !path.is_dir() {
        return Err(Error::Custom(
            "userGeneratedContentPath must point to a folder.".into(),
        ));
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
    fn rejects_raw_saved_credentials_writes() {
        assert!(validate_config_writes(&[entry("savedCredentials", "{}")]).is_err());
        assert!(validate_config_writes(&[entry("config:vrcx_savedcredentials", "{}")]).is_err());
    }
}
