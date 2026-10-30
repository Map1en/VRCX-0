use crate::auth::test_support::{MemoryAuthCredentialStore, MemoryAuthSessionCookies};
use crate::auth::AuthCredentialStore;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::json;

use super::super::snapshot::saved_snapshot;
use super::super::storage::{
    read_saved_credentials, LAST_USER_LOGGED_IN_KEY, SAVED_CREDENTIALS_KEY,
};
use super::super::types::LoginSuccessRecordInput;
use super::{clear_saved_password, record_login_success};

fn contains_secret_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(object) => object.iter().any(|(key, value)| {
            matches!(key.as_str(), "password" | "cookies") || contains_secret_key(value)
        }),
        serde_json::Value::Array(values) => values.iter().any(contains_secret_key),
        _ => false,
    }
}

#[test]
fn saved_snapshot_redacts_passwords_and_cookies() -> vrcx_0_application_core::Result<()> {
    let config = MemoryAuthCredentialStore::default();
    config.set_string(
        SAVED_CREDENTIALS_KEY,
        &json!({
            "usr_1": {
                "user": {
                    "id": "usr_1",
                    "displayName": "Example",
                    "username": "example",
                    "iconUrl": "https://example.test/icon.png",
                    "password": "nested-secret",
                    "profile": {
                        "cookies": "nested-cookie"
                    }
                },
                "loginParams": {
                    "username": "login@example.com",
                    "password": "secret"
                },
                "cookies": "raw-cookie-b64"
            }
        })
        .to_string(),
    )?;
    config.set_string(LAST_USER_LOGGED_IN_KEY, "usr_1")?;

    let snapshot = saved_snapshot(&config)?;
    let serialized_snapshot = serde_json::to_value(&snapshot)?;
    assert!(!contains_secret_key(&serialized_snapshot));
    let credential = &snapshot.saved_credentials_list[0];
    assert_eq!(credential.login_params.username, "login@example.com",);
    assert_eq!(credential.user.id, "usr_1");
    assert_eq!(credential.user.display_name.as_deref(), Some("Example"));
    assert_eq!(credential.user.username.as_deref(), Some("example"));
    assert_eq!(
        credential.user.icon_url.as_deref(),
        Some("https://example.test/icon.png")
    );
    assert!(credential.has_login_credentials);
    assert!(credential.has_cookies);

    Ok(())
}

fn test_cookie_store() -> MemoryAuthSessionCookies {
    MemoryAuthSessionCookies::default()
}

#[test]
fn record_login_success_with_save_credentials_captures_live_cookies(
) -> vrcx_0_application_core::Result<()> {
    let config = MemoryAuthCredentialStore::default();
    let web = test_cookie_store();
    let cookie_payload = B64.encode(
        serde_json::to_vec(&json!([
            {"Name": "auth", "Value": "new-account", "Domain": ".vrchat.cloud", "Path": "/"},
            {"Name": "twoFactorAuth", "Value": "new-account-2fa", "Domain": ".vrchat.cloud", "Path": "/"}
        ]))?,
    );
    web.set_cookies(&cookie_payload)?;
    let live_cookies = web.get_cookies();

    record_login_success(
        &config,
        &web,
        LoginSuccessRecordInput {
            user: json!({ "id": "usr_new", "displayName": "New User" }).into(),
            login_params: json!({
                "username": "new@example.test",
                "password": "secret"
            })
            .into(),
            stored_login_params: None,
            record: crate::auth::SavedCredentialRecordMode::WithPassword,
        },
    )?;

    assert_eq!(
        read_saved_credentials(&config)?["usr_new"]
            .cookies
            .as_deref(),
        Some(live_cookies.as_str())
    );
    Ok(())
}

#[test]
fn record_login_success_without_save_credentials_does_not_persist_a_new_entry(
) -> vrcx_0_application_core::Result<()> {
    let config = MemoryAuthCredentialStore::default();
    let web = test_cookie_store();

    record_login_success(
        &config,
        &web,
        LoginSuccessRecordInput {
            user: json!({ "id": "usr_new", "displayName": "New User" }).into(),
            login_params: json!({
                "username": "new@example.test",
                "password": "secret"
            })
            .into(),
            stored_login_params: None,
            record: crate::auth::SavedCredentialRecordMode::ExistingOnly,
        },
    )?;

    let saved_credentials = read_saved_credentials(&config)?;
    assert!(
        !saved_credentials.contains_key("usr_new"),
        "headless/non-interactive logins must never persist a new saved credential"
    );
    assert_eq!(config.get_string(LAST_USER_LOGGED_IN_KEY, "")?, "usr_new");
    Ok(())
}

#[test]
fn record_login_success_without_save_credentials_refreshes_an_existing_record_in_place(
) -> vrcx_0_application_core::Result<()> {
    let config = MemoryAuthCredentialStore::default();
    let web = test_cookie_store();

    config.set_string(
        SAVED_CREDENTIALS_KEY,
        &json!({
            "usr_1": {
                "user": { "id": "usr_1", "displayName": "Old Name" },
                "loginParams": {
                    "username": "login@example.com",
                    "password": "original-secret"
                },
                "cookies": "stale-cookie"
            }
        })
        .to_string(),
    )?;

    record_login_success(
        &config,
        &web,
        LoginSuccessRecordInput {
            user: json!({ "id": "usr_1", "displayName": "New Name" }).into(),
            login_params: json!({
                "username": "login@example.com",
                "password": "ignored-because-save-credentials-is-false"
            })
            .into(),
            stored_login_params: None,
            record: crate::auth::SavedCredentialRecordMode::ExistingOnly,
        },
    )?;

    let saved_credentials = read_saved_credentials(&config)?;
    let record = saved_credentials
        .get("usr_1")
        .expect("existing saved credential must be kept");
    assert_eq!(record.user.display_name.as_deref(), Some("New Name"));
    assert_eq!(
        record.login_params.password.as_deref(),
        Some("original-secret"),
        "save_credentials=false must never overwrite the stored password"
    );
    assert!(
        record.cookies.is_none(),
        "cookies must be synced from the live cookie store, which has none in this test"
    );
    Ok(())
}

#[test]
fn legacy_records_decode_to_typed_credentials_and_keep_snapshot_ordering(
) -> vrcx_0_application_core::Result<()> {
    let config = MemoryAuthCredentialStore::default();
    config.set_string(
        SAVED_CREDENTIALS_KEY,
        &json!({
            "legacy-key": {
                "user": {
                    "id": "usr_z",
                    "displayName": "Zulu",
                    "username": "zulu",
                    "iconUrl": "https://example.test/icon",
                    "password": "must-not-reach-the-snapshot"
                },
                "loginParmas": {
                    "username": "zulu@example.test",
                    "password": "zulu-secret"
                }
            },
            "usr_a": {
                "user": { "id": "usr_a", "displayName": "Alpha" },
                "loginParams": {
                    "username": "alpha@example.test",
                    "password": "alpha-secret",
                    "endpoint": "https://legacy.example.test",
                    "websocket": "wss://legacy.example.test"
                }
            }
        })
        .to_string(),
    )?;
    config.set_string(LAST_USER_LOGGED_IN_KEY, "usr_z")?;

    let credentials = read_saved_credentials(&config)?;
    assert!(!credentials.contains_key("legacy-key"));
    assert_eq!(
        credentials["usr_z"].user.display_name.as_deref(),
        Some("Zulu")
    );
    assert_eq!(
        credentials["usr_z"].user.icon_url.as_deref(),
        Some("https://example.test/icon")
    );
    assert_eq!(
        credentials["usr_z"].login_params.password.as_deref(),
        Some("zulu-secret")
    );
    assert_eq!(credentials["usr_a"].login_params.endpoint, "");
    assert_eq!(credentials["usr_a"].login_params.websocket, "");

    let snapshot = saved_snapshot(&config)?;
    assert_eq!(snapshot.saved_credentials_list[0].user.id, "usr_z");
    assert_eq!(
        snapshot.saved_credentials_list[0]
            .user
            .display_name
            .as_deref(),
        Some("Zulu")
    );
    assert_eq!(
        snapshot.saved_credentials_list[0].user.username.as_deref(),
        Some("zulu")
    );
    assert_eq!(
        snapshot.saved_credentials_list[0].user.icon_url.as_deref(),
        Some("https://example.test/icon")
    );
    assert_eq!(snapshot.saved_credentials_list[1].user.id, "usr_a");
    let serialized = serde_json::to_value(snapshot)?;
    assert!(!contains_secret_key(&serialized));

    let persisted: serde_json::Value = serde_json::from_str(
        &config
            .get_raw(SAVED_CREDENTIALS_KEY)?
            .expect("normalized credentials must be persisted"),
    )?;
    assert!(persisted.get("legacy-key").is_none());
    assert!(persisted["usr_z"].get("loginParmas").is_none());
    assert_eq!(
        persisted["usr_z"]["user"]["iconUrl"],
        "https://example.test/icon"
    );
    assert_eq!(persisted["usr_a"]["loginParams"]["endpoint"], "");
    assert_eq!(persisted["usr_a"]["loginParams"]["websocket"], "");
    Ok(())
}

fn seed_password_record(config: &MemoryAuthCredentialStore) -> vrcx_0_application_core::Result<()> {
    config.set_string(
        SAVED_CREDENTIALS_KEY,
        &json!({
            "usr_1": {
                "user": { "id": "usr_1", "displayName": "Name" },
                "loginParams": {
                    "username": "login@example.com",
                    "password": "original-secret"
                },
                "cookies": "stored-cookie"
            }
        })
        .to_string(),
    )
}

#[test]
fn a_qr_login_keeps_the_saved_password_of_an_existing_record() -> vrcx_0_application_core::Result<()>
{
    let config = MemoryAuthCredentialStore::default();
    seed_password_record(&config)?;

    record_login_success(
        &config,
        &MemoryAuthSessionCookies::default(),
        LoginSuccessRecordInput {
            user: json!({ "id": "usr_1", "displayName": "Name" }).into(),
            login_params: json!({}).into(),
            stored_login_params: None,
            record: crate::auth::SavedCredentialRecordMode::WithoutPassword,
        },
    )?;

    let saved_credentials = read_saved_credentials(&config)?;
    assert_eq!(
        saved_credentials["usr_1"].login_params.password.as_deref(),
        Some("original-secret")
    );
    Ok(())
}

#[test]
fn clearing_the_saved_password_keeps_a_passwordless_record() -> vrcx_0_application_core::Result<()>
{
    let config = MemoryAuthCredentialStore::default();
    seed_password_record(&config)?;

    let snapshot = clear_saved_password(&config, "usr_1".into())?;

    let record = &read_saved_credentials(&config)?["usr_1"];
    assert_eq!(record.login_params.username, "login@example.com");
    assert!(record.login_params.password.is_none());
    assert!(record.cookies.is_none());
    let listed = &snapshot.saved_credentials_list[0];
    assert!(!listed.has_login_credentials);
    assert!(clear_saved_password(&config, "usr_missing".into()).is_err());
    Ok(())
}
