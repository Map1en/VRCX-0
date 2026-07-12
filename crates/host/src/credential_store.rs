use sha2::{Digest, Sha256};

use crate::Error;

type Result<T> = std::result::Result<T, Error>;

const WEBDAV_CREDENTIAL_SERVICE: &str = "VRCX-0 WebDAV";

pub fn webdav_credential_key(server_url: &str, username: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(server_url.trim().as_bytes());
    digest.update([0]);
    digest.update(username.trim().as_bytes());
    format!("webdav-{:x}", digest.finalize())
}

fn entry(key: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(WEBDAV_CREDENTIAL_SERVICE, key)
        .map_err(|error| Error::Custom(format!("System credential store is unavailable: {error}")))
}

pub fn load_webdav_password(key: &str) -> Result<Option<String>> {
    match entry(key)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(Error::Custom(format!(
            "Unable to read the WebDAV password from the system credential store: {error}"
        ))),
    }
}

pub fn store_webdav_password(key: &str, password: &str) -> Result<()> {
    if password.is_empty() {
        return Err(Error::Custom("WebDAV password is empty.".into()));
    }
    entry(key)?.set_password(password).map_err(|error| {
        Error::Custom(format!(
            "Unable to save the WebDAV password in the system credential store: {error}"
        ))
    })
}

pub fn delete_webdav_password(key: &str) -> Result<bool> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(Error::Custom(format!(
            "Unable to delete the WebDAV password from the system credential store: {error}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static KEYRING_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn credential_key_is_stable_and_scoped() {
        let first = webdav_credential_key("https://dav.example.test/root", "alice");
        assert_eq!(
            first,
            webdav_credential_key("https://dav.example.test/root", "alice")
        );
        assert_ne!(
            first,
            webdav_credential_key("https://dav.example.test/root", "bob")
        );
    }

    #[test]
    fn credential_store_failures_never_fall_back_to_plaintext() {
        let _guard = KEYRING_TEST_LOCK.lock().unwrap();
        let _ = keyring::Entry::new("VRCX-0 test initialization", "test");
        let original_store = keyring_core::get_default_store();
        keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());

        let key = "webdav-test-unavailable";
        let probe = keyring::Entry::new(WEBDAV_CREDENTIAL_SERVICE, key).unwrap();
        let credential = probe
            .inner
            .as_any()
            .downcast_ref::<keyring_core::mock::Cred>()
            .unwrap();
        credential.set_error(keyring_core::Error::Invalid(
            "unavailable".into(),
            "test failure".into(),
        ));

        let error = load_webdav_password(key).unwrap_err();
        assert!(error.to_string().contains("Unable to read"));

        if let Some(original_store) = original_store {
            keyring_core::set_default_store(original_store);
        } else {
            keyring_core::unset_default_store();
        }
    }
}
