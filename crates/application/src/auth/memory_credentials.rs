use vrcx_0_application_core::MemoryConfigStore;

use super::{AuthCredentialStore, SealedAuthSecret};

impl AuthCredentialStore for MemoryConfigStore {
    fn is_encrypting_writes(&self) -> bool {
        false
    }
    fn is_secret_store_initialized(&self) -> bool {
        false
    }
    fn open_secret(&self, stored: &str) -> Option<String> {
        Some(stored.to_string())
    }
    fn seal_secret(&self, _previous: Option<&str>, plaintext: &str) -> SealedAuthSecret {
        SealedAuthSecret {
            stored: plaintext.to_string(),
            encrypted: false,
        }
    }
    fn is_sealed_secret(&self, _value: &str) -> bool {
        false
    }
    fn is_other_machine_secret(&self, _value: &str) -> bool {
        false
    }
    fn is_own_secret_behind_other_machines(&self, _value: &str) -> bool {
        false
    }
}
