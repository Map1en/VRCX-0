use serde_json::{json, Value};
use vrcx_0_application_core::{ConfigStore, MemoryConfigStore, Result};

use super::super::service::record_login_success;
use super::super::types::LoginSuccessRecordInput;
use super::{saved_credential_session_data, saved_login_credentials, AuthCredentialStore};
use super::{SealedAuthSecret, SAVED_CREDENTIALS_KEY};
use crate::auth::test_support::MemoryAuthSessionCookies;
use crate::auth::AuthSessionCookies;

const PREFIX: &str = "enc1:";

#[derive(Clone)]
struct MachineStore {
    machine: &'static str,
    config: MemoryConfigStore,
}

impl MachineStore {
    fn pair() -> (Self, Self) {
        let config = MemoryConfigStore::default();
        (
            Self {
                machine: "windows",
                config: config.clone(),
            },
            Self {
                machine: "linux",
                config,
            },
        )
    }

    fn slots(value: &str) -> Option<Vec<(&str, &str)>> {
        value
            .strip_prefix(PREFIX)?
            .split(',')
            .map(|slot| slot.split_once(':'))
            .collect()
    }
}

impl ConfigStore for MachineStore {
    fn get_raw(&self, key: &str) -> Result<Option<String>> {
        self.config.get_raw(key)
    }

    fn get_bool(&self, key: &str, default: bool) -> Result<bool> {
        self.config.get_bool(key, default)
    }

    fn get_string(&self, key: &str, default: &str) -> Result<String> {
        self.config.get_string(key, default)
    }

    fn get_json(&self, key: &str, default: Value) -> Result<Value> {
        self.config.get_json(key, default)
    }

    fn set_bool(&self, key: &str, value: bool) -> Result<()> {
        self.config.set_bool(key, value)
    }

    fn set_string(&self, key: &str, value: &str) -> Result<()> {
        self.config.set_string(key, value)
    }

    fn set_json(&self, key: &str, value: &Value) -> Result<()> {
        self.config.set_json(key, value)
    }

    fn remove(&self, key: &str) -> Result<()> {
        self.config.remove(key)
    }

    fn write_generation(&self) -> u64 {
        self.config.write_generation()
    }
}

impl AuthCredentialStore for MachineStore {
    fn is_encrypting_writes(&self) -> bool {
        true
    }

    fn is_secret_store_initialized(&self) -> bool {
        true
    }

    fn open_secret(&self, stored: &str) -> Option<String> {
        if !stored.starts_with(PREFIX) {
            return Some(stored.to_string());
        }
        Self::slots(stored)?
            .into_iter()
            .find(|(machine, _)| *machine == self.machine)
            .map(|(_, plaintext)| plaintext.to_string())
    }

    fn seal_secret(&self, previous: Option<&str>, plaintext: &str) -> SealedAuthSecret {
        let mut stored = format!("{PREFIX}{}:{plaintext}", self.machine);
        for (machine, other) in previous
            .and_then(Self::slots)
            .unwrap_or_default()
            .into_iter()
            .filter(|(machine, _)| *machine != self.machine)
        {
            stored.push_str(&format!(",{machine}:{other}"));
        }
        SealedAuthSecret {
            stored,
            encrypted: true,
        }
    }

    fn is_sealed_secret(&self, value: &str) -> bool {
        value.starts_with(PREFIX)
    }

    fn is_other_machine_secret(&self, value: &str) -> bool {
        Self::slots(value)
            .is_some_and(|slots| slots.iter().all(|(machine, _)| *machine != self.machine))
    }

    fn is_own_secret_behind_other_machines(&self, value: &str) -> bool {
        Self::slots(value).is_some_and(|slots| {
            slots
                .iter()
                .position(|(machine, _)| *machine == self.machine)
                .is_some_and(|position| position > 0)
        })
    }
}

fn first_password_slot(store: &MachineStore) -> Result<String> {
    let raw: serde_json::Value =
        serde_json::from_str(&store.get_raw(SAVED_CREDENTIALS_KEY)?.unwrap_or_default())?;
    let password = raw["usr_1"]["loginParams"]["password"]
        .as_str()
        .unwrap_or_default();
    Ok(MachineStore::slots(password)
        .and_then(|slots| slots.first().map(|(machine, _)| machine.to_string()))
        .unwrap_or_default())
}

fn log_in(store: &MachineStore, password: &str, cookies: &str) -> Result<()> {
    let jar = MemoryAuthSessionCookies::default();
    jar.set(cookies)?;
    record_login_success(
        store,
        &jar,
        LoginSuccessRecordInput {
            user: json!({ "id": "usr_1", "displayName": "Example" }).into(),
            login_params: json!({
                "username": "login@example.com",
                "password": password
            })
            .into(),
            stored_login_params: None,
            record: crate::auth::SavedCredentialRecordMode::WithPassword,
        },
    )?;
    Ok(())
}

fn password(store: &MachineStore) -> Result<Option<String>> {
    Ok(saved_login_credentials(store, "usr_1")?.map(|credentials| credentials.password))
}

fn cookies(store: &MachineStore) -> Result<Option<String>> {
    Ok(saved_credential_session_data(store, "usr_1")?.and_then(|session| session.cookies))
}

#[test]
fn each_machine_keeps_its_own_saved_credentials_in_a_shared_data_dir() -> Result<()> {
    let (windows, linux) = MachineStore::pair();

    log_in(&windows, "windows-password", "windows-cookies")?;
    let written_by_windows = windows.get_raw(SAVED_CREDENTIALS_KEY)?;

    assert_eq!(password(&linux)?, None);
    assert_eq!(cookies(&linux)?, None);
    assert_eq!(
        windows.get_raw(SAVED_CREDENTIALS_KEY)?,
        written_by_windows,
        "reading on another machine must not clear the ciphertext"
    );

    log_in(&linux, "linux-password", "linux-cookies")?;
    assert_eq!(first_password_slot(&linux)?, "linux");

    assert_eq!(password(&windows)?.as_deref(), Some("windows-password"));
    assert_eq!(
        first_password_slot(&windows)?,
        "windows",
        "reading moves the used slot to the front"
    );
    assert_eq!(cookies(&windows)?.as_deref(), Some("windows-cookies"));
    assert_eq!(password(&linux)?.as_deref(), Some("linux-password"));
    assert_eq!(cookies(&linux)?.as_deref(), Some("linux-cookies"));

    log_in(&windows, "windows-password-2", "windows-cookies-2")?;

    assert_eq!(password(&windows)?.as_deref(), Some("windows-password-2"));
    assert_eq!(password(&linux)?.as_deref(), Some("linux-password"));
    assert_eq!(cookies(&linux)?.as_deref(), Some("linux-cookies"));
    Ok(())
}
