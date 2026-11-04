use crate::common::row_string;
use crate::database::DatabaseService;
use crate::Error;
use sha2::{Digest, Sha256};

use super::local::config_set_values;
use super::repository::{ensure_config_table, remove};
use super::types::{resolve_config_key, ConfigWriteEntry};

const CONFIG_OBFUSCATION_PREFIX: &str = "cfgobf1:";
const CONFIG_OBFUSCATION_MASK: &[u8] = b"vrcx-0-config-values";
const CONFIG_OBFUSCATION_CHECKSUM_BYTES: usize = 8;

const OBFUSCATED_CONFIG_KEYS: &[&str] = &[
    "config:vrcx_assistant.apikey",
    "config:vrcx_feedlogger",
    "config:vrcx_integrationapitoken",
    "config:vrcx_llm.endpoints",
    "config:vrcx_mcpservertoken",
    "config:vrcx_screenshotsharetargets",
    "config:vrcx_shareownerkeys",
    "config:vrcx_translationapikey",
    "config:vrcx_webhookurl",
    "config:vrcx_youtubeapikey",
];

pub fn migrate_sensitive_config_obfuscation(db: &DatabaseService) -> Result<bool, Error> {
    ensure_config_table(db)?;
    let entries = db
        .execute("SELECT key, value FROM configs", &Default::default())?
        .into_iter()
        .filter_map(|row| {
            let key = row_string(&row, 0);
            let value = row_string(&row, 1);
            (is_obfuscated_config_key(&key)
                && !value.is_empty()
                && decode_obfuscated_frame(&value).is_none())
            .then_some(ConfigWriteEntry { key, value })
        })
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return Ok(false);
    }
    remove(db, crate::secrets::CLEANUP_COMPLETED_CONFIG_KEY)?;
    config_set_values(db, entries)?;
    Ok(true)
}

pub(super) fn encode_config_value(key: &str, value: &str) -> String {
    if value.is_empty() || !is_obfuscated_config_key(key) {
        return value.to_string();
    }
    let body = value
        .bytes()
        .enumerate()
        .map(|(index, byte)| {
            format!(
                "{:02x}",
                byte ^ CONFIG_OBFUSCATION_MASK[index % CONFIG_OBFUSCATION_MASK.len()]
            )
        })
        .collect::<String>();
    let checksum = obfuscation_checksum(value.as_bytes());
    format!(
        "{CONFIG_OBFUSCATION_PREFIX}{:x}:{checksum}:{body}",
        value.len()
    )
}

pub(super) fn decode_config_value(key: &str, stored: String) -> String {
    if !is_obfuscated_config_key(key) {
        return stored;
    }
    decode_obfuscated_frame(&stored).unwrap_or(stored)
}

fn decode_obfuscated_frame(stored: &str) -> Option<String> {
    let frame = stored.strip_prefix(CONFIG_OBFUSCATION_PREFIX)?;
    let mut fields = frame.splitn(3, ':');
    let expected_len = usize::from_str_radix(fields.next()?, 16).ok()?;
    let expected_checksum = fields.next()?;
    let body = fields.next()?;
    if expected_checksum.len() != CONFIG_OBFUSCATION_CHECKSUM_BYTES * 2
        || body.len() != expected_len.checked_mul(2)?
    {
        return None;
    }
    let bytes = (0..body.len())
        .step_by(2)
        .map(|index| {
            body.get(index..index + 2)
                .and_then(|pair| u8::from_str_radix(pair, 16).ok())
                .ok_or(())
        })
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    let plaintext = bytes
        .into_iter()
        .enumerate()
        .map(|(index, byte)| byte ^ CONFIG_OBFUSCATION_MASK[index % CONFIG_OBFUSCATION_MASK.len()])
        .collect::<Vec<_>>();
    if obfuscation_checksum(&plaintext) != expected_checksum {
        return None;
    }
    String::from_utf8(plaintext).ok()
}

fn obfuscation_checksum(value: &[u8]) -> String {
    Sha256::digest(value)[..CONFIG_OBFUSCATION_CHECKSUM_BYTES]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_obfuscated_config_key(key: &str) -> bool {
    let key = resolve_config_key(key);
    OBFUSCATED_CONFIG_KEYS.binary_search(&key.as_str()).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_key_registry_accepts_aliases_and_rejects_regular_config() {
        for key in [
            "assistant.apiKey",
            "feedLogger",
            "integrationApiToken",
            "llm.endpoints",
            "mcpServerToken",
            "screenshotShareTargets",
            "VRCX_ShareOwnerKeys",
            "translationAPIKey",
            "webhookUrl",
            "youtubeAPIKey",
        ] {
            assert!(is_obfuscated_config_key(key), "missing sensitive key {key}");
        }
        assert!(!is_obfuscated_config_key("ThemeMode"));
    }

    #[test]
    fn config_obfuscation_round_trips_unicode() {
        let plaintext = "sk-检查-🔑-123";
        let stored = encode_config_value("translationAPIKey", plaintext);

        assert!(stored.starts_with(CONFIG_OBFUSCATION_PREFIX));
        assert!(!stored.contains(plaintext));
        assert_eq!(decode_config_value("translationAPIKey", stored), plaintext);
    }

    #[test]
    fn regular_config_values_are_unchanged() {
        assert_eq!(encode_config_value("ThemeMode", "dark"), "dark");
        assert_eq!(decode_config_value("ThemeMode", "dark".into()), "dark");
    }

    #[test]
    fn legacy_plaintext_remains_readable_until_migration() {
        assert_eq!(
            decode_config_value("webhookUrl", "https://example.test/hook".into()),
            "https://example.test/hook"
        );
    }

    #[test]
    fn legacy_plaintext_with_reserved_prefix_is_not_misdecoded() {
        for plaintext in ["cfgobf1:not-hex", "cfgobf1:1:0000000000000000:00"] {
            assert_eq!(
                decode_config_value("mcpServerToken", plaintext.into()),
                plaintext
            );
        }
    }
}
