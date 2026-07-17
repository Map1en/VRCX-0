use std::sync::OnceLock;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, Generate, KeyInit},
    XChaCha20Poly1305, XNonce,
};

const ENCRYPTED_PREFIX: &str = "enc1:";
const NONCE_LEN: usize = 24;
pub const CLEANUP_COMPLETED_CONFIG_KEY: &str = "secretsAtRestCleanupCompletedV1";

struct SecretsAtRest {
    key: Option<[u8; 32]>,
    encrypt_writes: bool,
}

static SECRETS: OnceLock<SecretsAtRest> = OnceLock::new();

fn seal_with_nonce(key: &[u8; 32], nonce: &XNonce, plaintext: &str) -> Option<String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).ok()?;
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).ok()?;
    let mut payload = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(nonce.as_ref());
    payload.extend_from_slice(&ciphertext);
    Some(format!("{ENCRYPTED_PREFIX}{}", STANDARD.encode(payload)))
}

fn try_seal_with(key: &[u8; 32], plaintext: &str) -> Option<String> {
    let nonce = XNonce::try_generate().ok()?;
    seal_with_nonce(key, &nonce, plaintext)
}

fn open_with(key: Option<&[u8; 32]>, stored: &str) -> Option<String> {
    let Some(encoded) = stored.strip_prefix(ENCRYPTED_PREFIX) else {
        return Some(stored.to_string());
    };
    let key = key?;
    let payload = STANDARD.decode(encoded).ok()?;
    if payload.len() < NONCE_LEN {
        return None;
    }
    let (nonce, ciphertext) = payload.split_at(NONCE_LEN);
    let nonce = XNonce::try_from(nonce).ok()?;
    let cipher = XChaCha20Poly1305::new_from_slice(key).ok()?;
    let plaintext = cipher.decrypt(&nonce, ciphertext).ok()?;
    String::from_utf8(plaintext).ok()
}

fn seal_with_state(state: Option<&SecretsAtRest>, plaintext: &str) -> (String, bool) {
    let Some(state) = state else {
        return (plaintext.to_string(), false);
    };
    if !state.encrypt_writes {
        return (plaintext.to_string(), false);
    }
    let Some(key) = state.key.as_ref() else {
        return (plaintext.to_string(), false);
    };
    match try_seal_with(key, plaintext) {
        Some(sealed) => (sealed, true),
        None => {
            tracing::warn!("failed to encrypt a stored secret; falling back to plaintext");
            (plaintext.to_string(), false)
        }
    }
}

fn open_with_state(state: Option<&SecretsAtRest>, stored: &str) -> Option<String> {
    let Some(state) = state else {
        return Some(stored.to_string());
    };
    open_with(state.key.as_ref(), stored)
}

pub fn init_secrets(key: Option<[u8; 32]>, encrypt_writes: bool) {
    if SECRETS
        .set(SecretsAtRest {
            key,
            encrypt_writes,
        })
        .is_err()
    {
        tracing::warn!("secrets-at-rest state was already initialized; ignoring duplicate init");
    }
}

pub fn seal_secret(plaintext: &str) -> String {
    seal_secret_with_status(plaintext).0
}

pub fn seal_secret_with_status(plaintext: &str) -> (String, bool) {
    seal_with_state(SECRETS.get(), plaintext)
}

pub fn open_secret(stored: &str) -> Option<String> {
    open_with_state(SECRETS.get(), stored)
}

pub fn is_sealed_secret(stored: &str) -> bool {
    stored.starts_with(ENCRYPTED_PREFIX)
}

pub fn is_encrypting_writes() -> bool {
    SECRETS
        .get()
        .is_some_and(|state| state.encrypt_writes && state.key.is_some())
}

pub fn is_initialized() -> bool {
    SECRETS.get().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [7; 32];
    const OTHER_KEY: [u8; 32] = [9; 32];

    #[test]
    fn cipher_roundtrip_rejects_wrong_keys_and_damage() {
        let sealed = try_seal_with(&KEY, "secret-value").unwrap();
        assert!(sealed.starts_with("enc1:"));
        assert_eq!(
            open_with(Some(&KEY), &sealed).as_deref(),
            Some("secret-value")
        );
        assert_eq!(open_with(Some(&OTHER_KEY), &sealed), None);
        assert_eq!(open_with(None, &sealed), None);
        assert_eq!(open_with(Some(&KEY), "enc1:broken"), None);
        assert_eq!(
            open_with(Some(&KEY), "plain-value").as_deref(),
            Some("plain-value")
        );
    }

    #[test]
    fn cipher_storage_format_matches_the_v1_golden_vector() {
        let nonce_bytes = std::array::from_fn(|index| index as u8);
        let nonce = XNonce::from(nonce_bytes);
        let sealed = seal_with_nonce(&KEY, &nonce, "secret-value").unwrap();

        assert_eq!(
            sealed,
            "enc1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYX23LI959odtNEq/QiQ/C2yr8LrhAlISSgLCWQcQ=="
        );
        assert_eq!(
            open_with(Some(&KEY), &sealed).as_deref(),
            Some("secret-value")
        );
    }

    #[test]
    fn state_controls_reads_and_writes_without_global_initialization() {
        let disabled = SecretsAtRest {
            key: Some(KEY),
            encrypt_writes: false,
        };
        let missing_key = SecretsAtRest {
            key: None,
            encrypt_writes: true,
        };
        let enabled = SecretsAtRest {
            key: Some(KEY),
            encrypt_writes: true,
        };

        assert_eq!(seal_with_state(None, "plain"), ("plain".into(), false));
        assert_eq!(
            open_with_state(None, "enc1:not-decoded").as_deref(),
            Some("enc1:not-decoded")
        );
        assert_eq!(
            seal_with_state(Some(&disabled), "plain"),
            ("plain".into(), false)
        );
        assert_eq!(
            seal_with_state(Some(&missing_key), "plain"),
            ("plain".into(), false)
        );

        let (sealed, encrypted) = seal_with_state(Some(&enabled), "plain");
        assert!(encrypted);
        assert!(is_sealed_secret(&sealed));
        assert_eq!(
            open_with_state(Some(&enabled), &sealed).as_deref(),
            Some("plain")
        );
        assert_eq!(
            open_with_state(Some(&disabled), &sealed).as_deref(),
            Some("plain")
        );
        assert_eq!(open_with_state(Some(&missing_key), &sealed), None);
    }
}
