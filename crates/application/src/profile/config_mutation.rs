use std::path::PathBuf;

use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::{external_api, resolve_config_key, ConfigReadEntry, ConfigWriteEntry};

use super::ProfileConfigStore;

pub fn list_config_values(store: &dyn ProfileConfigStore) -> Result<Vec<ConfigReadEntry>> {
    store.list_values()
}

pub fn set_config_values(
    store: &dyn ProfileConfigStore,
    entries: Vec<ConfigWriteEntry>,
) -> Result<()> {
    for entry in &entries {
        validate_config_mutation(&entry.key, Some(&entry.value))?;
    }
    store.set_values(entries)
}

pub fn remove_config_value(store: &dyn ProfileConfigStore, key: String) -> Result<i64> {
    validate_config_mutation(&key, None)?;
    store.remove_value(key)
}

fn validate_config_mutation(key: &str, value: Option<&str>) -> Result<()> {
    match resolve_config_key(key).as_str() {
        "config:vrcx_savedcredentials" => Err(Error::Custom(
            "savedCredentials must be changed through the dedicated auth service.".into(),
        )),
        "config:vrcx_feedlogger" => Err(Error::Custom(
            "feedLogger must be changed through the feed logger settings.".into(),
        )),
        "config:vrcx_avatarautocleanup" => validate_avatar_auto_cleanup(value),
        "config:vrcx_usergeneratedcontentpath" => validate_ugc_path(value.unwrap_or_default()),
        "config:vrcx_translationapiendpoint" => validate_optional_provider_url(
            value.unwrap_or_default(),
            "translationAPIEndpoint must be an HTTP or HTTPS endpoint.",
        ),
        "config:vrcx_avatarremotedatabaseprovider" => validate_optional_provider_url(
            value.unwrap_or_default(),
            "VRCX_avatarRemoteDatabaseProvider must be an HTTP or HTTPS endpoint.",
        ),
        "config:vrcx_avatarremotedatabaseproviderlist" => {
            validate_provider_list(value.unwrap_or_default())
        }
        _ => Ok(()),
    }
}

fn validate_avatar_auto_cleanup(value: Option<&str>) -> Result<()> {
    match value {
        None | Some("Off" | "30" | "90" | "180" | "365") => Ok(()),
        Some(_) => Err(Error::Custom(
            "avatarAutoCleanup must be Off, 30, 90, 180, or 365.".into(),
        )),
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
    if value.is_empty() || external_api::request_origin(value).is_some() {
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
    use vrcx_0_application_core::MemoryConfigStore;

    fn entry(key: &str, value: &str) -> ConfigWriteEntry {
        ConfigWriteEntry {
            key: key.into(),
            value: value.into(),
        }
    }

    #[test]
    fn accepts_regular_config_and_http_providers() {
        let db = MemoryConfigStore::default();

        set_config_values(
            &db,
            vec![
                entry("SomeRegularSetting", "anything"),
                entry(
                    "translationAPIEndpoint",
                    "http://localhost:8123/v1/chat/completions",
                ),
                entry(
                    "VRCX_avatarRemoteDatabaseProviderList",
                    r#"["http://127.0.0.1:8123/api","https://10.0.0.5/api"]"#,
                ),
            ],
        )
        .unwrap();
    }

    #[test]
    fn rejects_invalid_provider_and_relative_ugc_writes() {
        let db = MemoryConfigStore::default();

        assert!(set_config_values(
            &db,
            vec![entry("translationAPIEndpoint", "ftp://example.com/api")]
        )
        .is_err());
        assert!(set_config_values(
            &db,
            vec![entry("userGeneratedContentPath", "relative/path")]
        )
        .is_err());
    }

    #[test]
    fn dedicated_auth_config_cannot_be_set_or_removed() {
        let db = MemoryConfigStore::default();

        assert!(set_config_values(&db, vec![entry("savedCredentials", "{}")]).is_err());
        assert!(set_config_values(&db, vec![entry("feedLogger", "{}")]).is_err());
        assert!(remove_config_value(&db, "config:vrcx_savedcredentials".into()).is_err());
    }

    #[test]
    fn avatar_auto_cleanup_accepts_only_supported_retention_values() {
        let db = MemoryConfigStore::default();

        for value in ["Off", "30", "90", "180", "365"] {
            set_config_values(&db, vec![entry("avatarAutoCleanup", value)]).unwrap();
        }
        for value in ["", "0", "31", " 30 ", "9223372036854775807"] {
            assert!(set_config_values(&db, vec![entry("avatarAutoCleanup", value)]).is_err());
        }

        assert_eq!(
            remove_config_value(&db, "avatarAutoCleanup".into()).unwrap(),
            1
        );
    }

    #[test]
    fn regular_removal_preserves_the_existing_count_contract() {
        let db = MemoryConfigStore::default();
        set_config_values(&db, vec![entry("ThemeMode", "dark")]).unwrap();

        assert_eq!(remove_config_value(&db, "ThemeMode".into()).unwrap(), 1);
        assert_eq!(remove_config_value(&db, "ThemeMode".into()).unwrap(), 0);
    }
}
