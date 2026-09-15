use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use vrcx_0_application_core::{Error, Result};
use vrcx_0_core::text::normalize_text;

use super::auth_credentials::saved_credential_password;
use super::AuthCredentialStore;

const PRIVACY_LOCK_KEY: &str = "privacyLock";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivacyLockEntry {
    #[serde(default)]
    locked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PrivacyLockRecord {
    pub locked: bool,
    pub has_password: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrivacyLockPasswordCheck {
    Matched,
    Mismatched,
    Unavailable,
}

#[derive(Debug, Default)]
pub struct PrivacyLockStore {
    entries: BTreeMap<String, PrivacyLockEntry>,
}

impl PrivacyLockStore {
    pub fn load(config: &dyn AuthCredentialStore) -> Result<Self> {
        let entries = match config.get_raw(PRIVACY_LOCK_KEY)? {
            Some(raw) => serde_json::from_str(&raw).unwrap_or_else(|error| {
                tracing::warn!(error = %error, "ignoring unreadable privacy lock state");
                BTreeMap::new()
            }),
            None => BTreeMap::new(),
        };
        Ok(Self { entries })
    }

    pub fn record(&self, user_id: &str) -> PrivacyLockRecord {
        let user_id = normalize_text(user_id);
        self.entries
            .get(&user_id)
            .map(|entry| PrivacyLockRecord {
                locked: entry.locked,
                has_password: entry.password.is_some(),
            })
            .unwrap_or_default()
    }

    pub fn set_password(
        &mut self,
        config: &dyn AuthCredentialStore,
        user_id: &str,
        password: &str,
    ) -> Result<bool> {
        let user_id = require_user_id(user_id)?;
        require_password(password)?;
        if self
            .entries
            .get(&user_id)
            .is_some_and(|entry| entry.password.is_some())
        {
            return Ok(false);
        }
        self.entries.entry(user_id).or_default().password = Some(password.to_string());
        self.persist(config)?;
        Ok(true)
    }

    pub fn change_password(
        &mut self,
        config: &dyn AuthCredentialStore,
        user_id: &str,
        current: &str,
        next: &str,
    ) -> Result<PrivacyLockPasswordCheck> {
        let user_id = require_user_id(user_id)?;
        require_password(next)?;
        let Some(entry) = self.entries.get_mut(&user_id) else {
            return Ok(PrivacyLockPasswordCheck::Unavailable);
        };
        let Some(existing) = entry.password.as_ref() else {
            return Ok(PrivacyLockPasswordCheck::Unavailable);
        };
        if existing != current {
            return Ok(PrivacyLockPasswordCheck::Mismatched);
        }
        entry.password = Some(next.to_string());
        self.persist(config)?;
        Ok(PrivacyLockPasswordCheck::Matched)
    }

    pub fn clear(&mut self, config: &dyn AuthCredentialStore, user_id: &str) -> Result<()> {
        let user_id = require_user_id(user_id)?;
        if self.entries.remove(&user_id).is_some() {
            self.persist(config)?;
        }
        Ok(())
    }

    pub fn engage(&mut self, config: &dyn AuthCredentialStore, user_id: &str) -> Result<bool> {
        let user_id = require_user_id(user_id)?;
        let Some(entry) = self.entries.get_mut(&user_id) else {
            return Ok(false);
        };
        if entry.password.is_none() {
            return Ok(false);
        }
        if !entry.locked {
            entry.locked = true;
            self.persist(config)?;
        }
        Ok(true)
    }

    pub fn unlock(
        &mut self,
        config: &dyn AuthCredentialStore,
        user_id: &str,
        password: &str,
    ) -> Result<PrivacyLockPasswordCheck> {
        let user_id = require_user_id(user_id)?;
        let Some(entry) = self.entries.get_mut(&user_id) else {
            return Ok(PrivacyLockPasswordCheck::Unavailable);
        };
        let Some(existing) = entry.password.as_ref() else {
            return Ok(PrivacyLockPasswordCheck::Unavailable);
        };
        if existing != password {
            return Ok(PrivacyLockPasswordCheck::Mismatched);
        }
        if entry.locked {
            entry.locked = false;
            self.persist(config)?;
        }
        Ok(PrivacyLockPasswordCheck::Matched)
    }

    fn persist(&self, config: &dyn AuthCredentialStore) -> Result<()> {
        if self.entries.is_empty() {
            return config.remove(PRIVACY_LOCK_KEY);
        }
        config.set_string(PRIVACY_LOCK_KEY, &serde_json::to_string(&self.entries)?)
    }
}

pub fn verify_saved_account_password(
    config: &dyn AuthCredentialStore,
    user_id: &str,
    password: &str,
) -> Result<PrivacyLockPasswordCheck> {
    Ok(match saved_credential_password(config, user_id)? {
        Some(saved) if saved.is_empty() => PrivacyLockPasswordCheck::Unavailable,
        Some(saved) if saved == password => PrivacyLockPasswordCheck::Matched,
        Some(_) => PrivacyLockPasswordCheck::Mismatched,
        None => PrivacyLockPasswordCheck::Unavailable,
    })
}

fn require_user_id(user_id: &str) -> Result<String> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Err(Error::Custom(
            "Privacy lock requires an active user id.".into(),
        ));
    }
    Ok(user_id)
}

fn require_password(password: &str) -> Result<()> {
    if password.is_empty() {
        return Err(Error::Custom("Privacy lock password is required.".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::auth::test_support::{MemoryAuthCredentialStore, MemoryAuthSessionCookies};
    use crate::auth::{record_login_success, LoginSuccessRecordInput};

    #[test]
    fn lock_state_survives_reload_and_only_unlock_clears_it() -> Result<()> {
        let config = MemoryAuthCredentialStore::default();
        let mut store = PrivacyLockStore::load(&config)?;
        assert!(!store.engage(&config, "usr_1")?);

        assert!(store.set_password(&config, "usr_1", "1234")?);
        assert!(!store.set_password(&config, "usr_1", "9999")?);
        assert!(store.engage(&config, "usr_1")?);

        let mut reloaded = PrivacyLockStore::load(&config)?;
        assert_eq!(
            reloaded.record("usr_1"),
            PrivacyLockRecord {
                locked: true,
                has_password: true
            }
        );
        assert_eq!(reloaded.record("usr_2"), PrivacyLockRecord::default());

        assert_eq!(
            reloaded.unlock(&config, "usr_1", "wrong")?,
            PrivacyLockPasswordCheck::Mismatched
        );
        assert!(reloaded.record("usr_1").locked);
        assert_eq!(
            reloaded.unlock(&config, "usr_1", "1234")?,
            PrivacyLockPasswordCheck::Matched
        );
        assert!(!PrivacyLockStore::load(&config)?.record("usr_1").locked);
        Ok(())
    }

    #[test]
    fn change_password_requires_the_current_password() -> Result<()> {
        let config = MemoryAuthCredentialStore::default();
        let mut store = PrivacyLockStore::load(&config)?;
        assert_eq!(
            store.change_password(&config, "usr_1", "1234", "5678")?,
            PrivacyLockPasswordCheck::Unavailable
        );
        store.set_password(&config, "usr_1", "1234")?;
        assert_eq!(
            store.change_password(&config, "usr_1", "0000", "5678")?,
            PrivacyLockPasswordCheck::Mismatched
        );
        assert_eq!(
            store.change_password(&config, "usr_1", "1234", "5678")?,
            PrivacyLockPasswordCheck::Matched
        );
        assert_eq!(
            store.unlock(&config, "usr_1", "5678")?,
            PrivacyLockPasswordCheck::Matched
        );
        Ok(())
    }

    #[test]
    fn clear_removes_the_user_entry_and_the_config_row_when_empty() -> Result<()> {
        let config = MemoryAuthCredentialStore::default();
        let mut store = PrivacyLockStore::load(&config)?;
        store.set_password(&config, "usr_1", "1234")?;
        store.engage(&config, "usr_1")?;
        store.clear(&config, "usr_1")?;
        assert_eq!(store.record("usr_1"), PrivacyLockRecord::default());
        assert_eq!(config.get_raw(PRIVACY_LOCK_KEY)?, None);
        Ok(())
    }

    #[test]
    fn empty_passwords_and_user_ids_are_rejected() -> Result<()> {
        let config = MemoryAuthCredentialStore::default();
        let mut store = PrivacyLockStore::load(&config)?;
        assert!(store.set_password(&config, "usr_1", "").is_err());
        assert!(store.set_password(&config, "  ", "1234").is_err());
        Ok(())
    }

    #[test]
    fn unreadable_state_is_ignored_instead_of_failing() -> Result<()> {
        let config = MemoryAuthCredentialStore::default();
        config.set_string(PRIVACY_LOCK_KEY, "not json")?;
        let store = PrivacyLockStore::load(&config)?;
        assert_eq!(store.record("usr_1"), PrivacyLockRecord::default());
        Ok(())
    }

    #[test]
    fn saved_account_password_check_reports_availability() -> Result<()> {
        let config = MemoryAuthCredentialStore::default();
        let cookies = MemoryAuthSessionCookies::default();
        assert_eq!(
            verify_saved_account_password(&config, "usr_1", "secret")?,
            PrivacyLockPasswordCheck::Unavailable
        );

        record_login_success(
            &config,
            &cookies,
            LoginSuccessRecordInput {
                user: json!({ "id": "usr_1", "displayName": "User" }).into(),
                login_params: json!({
                    "username": "user@example.test",
                    "password": "secret"
                })
                .into(),
                stored_login_params: None,
                save_credentials: true,
            },
        )?;

        assert_eq!(
            verify_saved_account_password(&config, "usr_1", "secret")?,
            PrivacyLockPasswordCheck::Matched
        );
        assert_eq!(
            verify_saved_account_password(&config, "usr_1", "other")?,
            PrivacyLockPasswordCheck::Mismatched
        );
        assert_eq!(
            verify_saved_account_password(&config, "usr_2", "secret")?,
            PrivacyLockPasswordCheck::Unavailable
        );
        Ok(())
    }
}
