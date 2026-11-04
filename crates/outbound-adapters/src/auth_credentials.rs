use vrcx_0_application::auth::{AuthCredentialStore, SealedAuthSecret};
use vrcx_0_persistence::secrets;

use crate::LocalConfigStore;

impl AuthCredentialStore for LocalConfigStore {
    fn is_encrypting_writes(&self) -> bool {
        secrets::is_encrypting_writes()
    }

    fn is_secret_store_initialized(&self) -> bool {
        secrets::is_initialized()
    }

    fn open_secret(&self, stored: &str) -> Option<String> {
        secrets::open_secret(stored)
    }

    fn seal_secret(&self, previous: Option<&str>, plaintext: &str) -> SealedAuthSecret {
        let sealed = secrets::seal_secret_with_status(previous, plaintext);
        SealedAuthSecret {
            stored: sealed.stored,
            encrypted: sealed.encrypted,
        }
    }

    fn is_sealed_secret(&self, value: &str) -> bool {
        secrets::is_sealed_secret(value)
    }

    fn is_other_machine_secret(&self, value: &str) -> bool {
        secrets::is_other_machine_secret(value)
    }

    fn is_own_secret_behind_other_machines(&self, value: &str) -> bool {
        secrets::promote_own_slot(value).is_some()
    }
}
