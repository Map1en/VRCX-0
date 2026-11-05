use std::sync::Arc;

use vrcx_0_application::auth::{migrate_saved_credential_secrets, AuthCredentialStore};
use vrcx_0_application::profile::SecretStartupActions;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

pub struct LocalSecretStartup {
    db: Arc<DatabaseService>,
    config: ConfigRepository,
    credentials: Arc<dyn AuthCredentialStore>,
    allow_encrypted_writes: bool,
}

impl LocalSecretStartup {
    pub fn new(
        db: Arc<DatabaseService>,
        credentials: Arc<dyn AuthCredentialStore>,
        allow_encrypted_writes: bool,
    ) -> Self {
        Self {
            config: ConfigRepository::new(Arc::clone(&db)),
            db,
            credentials,
            allow_encrypted_writes,
        }
    }
}

impl SecretStartupActions for LocalSecretStartup {
    fn initialize(&mut self) {
        vrcx_0_persistence::secrets::init_secrets(
            vrcx_0_platform::machine_key::derive_secrets_key(),
            self.allow_encrypted_writes,
        );
    }

    fn is_encrypting_writes(&mut self) -> bool {
        vrcx_0_persistence::secrets::is_encrypting_writes()
    }

    fn migrate_cookies(&mut self) -> Result<()> {
        vrcx_0_persistence::cookies::migrate_default_cookies(&self.db)
            .map_err(|error| Error::Custom(error.to_string()))
            .map(|_| ())
    }

    fn migrate_saved_credentials(&mut self) -> Result<()> {
        migrate_saved_credential_secrets(self.credentials.as_ref()).map(|_| ())
    }

    fn migrate_sensitive_config_values(&mut self) -> Result<()> {
        vrcx_0_persistence::config::migrate_sensitive_config_obfuscation(&self.db)
            .map_err(|error| Error::Custom(error.to_string()))
            .map(|_| ())
    }

    fn read_cleanup_completed(&mut self) -> Result<bool> {
        self.config
            .get_bool(
                vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
                false,
            )
            .map_err(|error| Error::Custom(error.to_string()))
    }

    fn cleanup(&mut self) -> Result<()> {
        vrcx_0_persistence::maintenance::vacuum_after_secret_migration(&self.db)
            .map_err(|error| Error::Custom(error.to_string()))
    }

    fn record_cleanup_completed(&mut self) -> Result<()> {
        self.config
            .set_bool(
                vrcx_0_persistence::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
                true,
            )
            .map_err(|error| Error::Custom(error.to_string()))
    }
}
