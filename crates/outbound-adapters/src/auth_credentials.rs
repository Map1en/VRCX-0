use std::sync::Arc;

use vrcx_0_application::auth::{AuthCredentialStore, SealedAuthSecret};
use vrcx_0_application_core::Result;
use vrcx_0_persistence::{config::ConfigRepository, secrets, DatabaseService};

#[derive(Clone)]
pub struct LocalAuthCredentialStore {
    config: ConfigRepository,
    key_prefix: String,
}

impl LocalAuthCredentialStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self {
            config: ConfigRepository::new(db),
            key_prefix: String::new(),
        }
    }

    pub fn from_repository(config: ConfigRepository) -> Self {
        Self {
            config,
            key_prefix: String::new(),
        }
    }

    pub fn from_repository_with_prefix(config: ConfigRepository, key_prefix: &str) -> Self {
        Self {
            config,
            key_prefix: key_prefix.to_owned(),
        }
    }

    fn key(&self, key: &str) -> String {
        format!("{}{key}", self.key_prefix)
    }
}

impl AuthCredentialStore for LocalAuthCredentialStore {
    fn get_raw(&self, key: &str) -> Result<Option<String>> {
        self.config
            .get_raw(self.key(key).as_str())
            .map_err(Into::into)
    }

    fn get_string(&self, key: &str, default_value: &str) -> Result<String> {
        self.config
            .get_string(self.key(key).as_str(), default_value)
            .map_err(Into::into)
    }

    fn get_bool(&self, key: &str, default_value: bool) -> Result<bool> {
        self.config
            .get_bool(self.key(key).as_str(), default_value)
            .map_err(Into::into)
    }

    fn set_string(&self, key: &str, value: &str) -> Result<()> {
        self.config
            .set_string(self.key(key).as_str(), value)
            .map_err(Into::into)
    }

    fn remove(&self, key: &str) -> Result<()> {
        self.config
            .remove(self.key(key).as_str())
            .map_err(Into::into)
    }

    fn is_encrypting_writes(&self) -> bool {
        secrets::is_encrypting_writes()
    }

    fn is_secret_store_initialized(&self) -> bool {
        secrets::is_initialized()
    }

    fn open_secret(&self, stored: &str) -> Option<String> {
        secrets::open_secret(stored)
    }

    fn seal_secret(&self, plaintext: &str) -> SealedAuthSecret {
        let sealed = secrets::seal_secret_with_status(plaintext);
        SealedAuthSecret {
            stored: sealed.stored,
            encrypted: sealed.encrypted,
        }
    }

    fn is_sealed_secret(&self, value: &str) -> bool {
        secrets::is_sealed_secret(value)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TestDb {
        path: PathBuf,
        db: Option<Arc<DatabaseService>>,
    }

    impl TestDb {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "vrcx-0-auth-namespace-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("profile.sqlite3");
            let db = Arc::new(DatabaseService::new(&path).unwrap());
            Self { path, db: Some(db) }
        }
    }

    impl Drop for TestDb {
        fn drop(&mut self) {
            drop(self.db.take());
            if let Some(parent) = self.path.parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
    }

    #[test]
    fn headless_auth_config_does_not_read_or_replace_desktop_credentials() {
        let test_db = TestDb::new();
        let config = ConfigRepository::new(Arc::clone(test_db.db.as_ref().unwrap()));
        let desktop = LocalAuthCredentialStore::from_repository(config.clone());
        let headless =
            LocalAuthCredentialStore::from_repository_with_prefix(config, "headlessAuth:");

        desktop.set_string("savedCredentials", "desktop").unwrap();
        headless
            .set_string("savedCredentials", "collector")
            .unwrap();

        assert_eq!(
            desktop.get_string("savedCredentials", "").unwrap(),
            "desktop"
        );
        assert_eq!(
            headless.get_string("savedCredentials", "").unwrap(),
            "collector"
        );
    }
}
