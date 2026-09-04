use std::collections::HashMap;

use serde_json::Value;

pub const ALLOWED_REGISTRY_TYPES: [i32; 3] = [3, 4, 100];
pub const ALLOWED_REGISTRY_KEYS: [&str; 2] = ["LOGGING_ENABLED", "VRC_DEBUG_LOGGING"];
pub const ALLOWED_REGISTRY_KEY_PREFIXES: [&str; 8] = [
    "VRC_",
    "VRChat_",
    "vrchat_",
    "Screenmanager ",
    "UnityGraphicsQuality",
    "UnitySelectMonitor",
    "unity.",
    "PlayerPrefs_",
];

pub fn is_allowed_registry_key(key: &str) -> bool {
    ALLOWED_REGISTRY_KEYS.contains(&key)
        || ALLOWED_REGISTRY_KEY_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix))
        || is_unity_player_prefs_name(key)
        || is_unity_player_prefs_key(key)
}

pub fn is_unity_player_prefs_key(key: &str) -> bool {
    let Some((name, hash)) = key.rsplit_once("_h") else {
        return false;
    };
    !name.is_empty()
        && !hash.is_empty()
        && hash.bytes().all(|byte| byte.is_ascii_digit())
        && name.bytes().all(is_unity_player_prefs_name_byte)
}

fn is_unity_player_prefs_name(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(is_unity_player_prefs_name_byte)
}

fn is_unity_player_prefs_name_byte(byte: u8) -> bool {
    byte == b' ' || byte == b'.' || byte == b'_' || byte == b'-' || byte.is_ascii_alphanumeric()
}

#[derive(Debug)]
pub enum RegistryPolicyError {
    Json(serde_json::Error),
    Invalid(String),
}

impl std::fmt::Display for RegistryPolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RegistryPolicyError::Json(error) => write!(f, "{error}"),
            RegistryPolicyError::Invalid(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for RegistryPolicyError {}

impl From<serde_json::Error> for RegistryPolicyError {
    fn from(value: serde_json::Error) -> Self {
        RegistryPolicyError::Json(value)
    }
}

pub fn validate_registry_json(json: &str) -> Result<(), RegistryPolicyError> {
    let data: HashMap<String, HashMap<String, Value>> = serde_json::from_str(json)?;
    for (key, props) in data {
        let type_int = props
            .get("type")
            .and_then(|value| value.as_i64())
            .ok_or_else(|| {
                RegistryPolicyError::Invalid(format!("Invalid registry type for {key}"))
            })?;
        let type_int = i32::try_from(type_int).map_err(|_| {
            RegistryPolicyError::Invalid(format!("Invalid registry type for {key}"))
        })?;
        let value = props.get("data").ok_or_else(|| {
            RegistryPolicyError::Invalid(format!("Missing registry data for {key}"))
        })?;
        if type_int == 3 {
            validate_registry_key(&key)?;
            registry_backup_binary_bytes(&key, value)?;
        } else {
            validate_registry_entry(&key, value, type_int)?;
        }
    }
    Ok(())
}

pub fn registry_backup_binary_data(bytes: &[u8]) -> Value {
    Value::Array(bytes.iter().copied().map(Value::from).collect())
}

pub fn registry_backup_binary_bytes(
    key: &str,
    value: &Value,
) -> Result<Vec<u8>, RegistryPolicyError> {
    let Some(values) = value.as_array() else {
        return Err(RegistryPolicyError::Invalid(format!(
            "Invalid registry binary data for {key}."
        )));
    };
    values
        .iter()
        .map(|value| {
            value
                .as_u64()
                .and_then(|value| u8::try_from(value).ok())
                .ok_or_else(|| {
                    RegistryPolicyError::Invalid(format!("Invalid registry binary data for {key}."))
                })
        })
        .collect()
}

pub fn validate_registry_entry(
    key: &str,
    value: &Value,
    type_int: i32,
) -> Result<(), RegistryPolicyError> {
    validate_registry_key(key)?;
    if !ALLOWED_REGISTRY_TYPES.contains(&type_int) {
        return Err(RegistryPolicyError::Invalid(format!(
            "Registry type {type_int} is not allowed for {key}."
        )));
    }

    match type_int {
        3 if value.is_string() => Ok(()),
        4 if value
            .as_i64()
            .and_then(|raw| i32::try_from(raw).ok())
            .is_some() =>
        {
            Ok(())
        }
        100 if value.as_f64().is_some() => Ok(()),
        3 | 4 | 100 => Err(RegistryPolicyError::Invalid(format!(
            "Invalid registry value shape for {key}."
        ))),
        _ => unreachable!("registry type allow-list is checked before value validation"),
    }
}

pub fn validate_registry_key(key: &str) -> Result<(), RegistryPolicyError> {
    let key = key.trim();
    if key.is_empty() || key.len() > 128 {
        return Err(RegistryPolicyError::Invalid(
            "Invalid VRChat registry key.".into(),
        ));
    }

    let allowed = key.bytes().all(|byte| {
        (byte == b' ' || byte.is_ascii_graphic()) && !matches!(byte, b'\\' | b'/' | b'"' | b'\'')
    });
    if !allowed {
        return Err(RegistryPolicyError::Invalid(format!(
            "VRChat registry key '{key}' contains unsupported characters."
        )));
    }

    if !is_allowed_registry_key(key) {
        return Err(RegistryPolicyError::Invalid(format!(
            "VRChat registry key '{key}' is not in the allowed PlayerPrefs set."
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_allowed_registry_keys() {
        assert!(is_allowed_registry_key("LOGGING_ENABLED"));
        assert!(is_allowed_registry_key("VRC_DEBUG_LOGGING"));
        assert!(is_allowed_registry_key("VRC_TEST"));
        assert!(is_allowed_registry_key("UnityGraphicsQuality"));
        assert!(is_allowed_registry_key("playerHeight_h56066313"));
        assert!(is_allowed_registry_key("playerHeight"));
    }

    #[test]
    fn rejects_unsupported_registry_keys() {
        assert!(!is_allowed_registry_key(""));
        assert!(!is_allowed_registry_key("Bad Key!"));
        assert!(!is_allowed_registry_key("Bad/Key"));
        assert!(!is_allowed_registry_key("Bad\\Key"));
        assert!(!is_allowed_registry_key("Bad\"Key"));
        assert!(!is_allowed_registry_key(""));
    }

    #[test]
    fn recognizes_only_numeric_unity_player_prefs_hash_suffixes() {
        assert!(is_unity_player_prefs_key("playerHeight_h56066313"));
        assert!(!is_unity_player_prefs_key("playerHeight_h"));
        assert!(!is_unity_player_prefs_key("_h56066313"));
        assert!(!is_unity_player_prefs_key("playerHeight_habc"));
    }

    #[test]
    fn validate_registry_key_enforces_allow_list() {
        assert!(validate_registry_key("VRC_DEBUG_LOGGING").is_ok());
        assert!(validate_registry_key("playerHeight_h56066313").is_ok());
        assert!(validate_registry_key("").is_err());
        assert!(validate_registry_key("Bad/Key").is_err());
        assert!(validate_registry_key("Bad Key!").is_err());
    }

    #[test]
    fn validate_registry_entry_checks_type_and_shape() {
        assert!(validate_registry_entry("VRC_X", &Value::String("v".into()), 3).is_ok());
        assert!(validate_registry_entry("VRC_X", &serde_json::json!(7), 4).is_ok());
        assert!(validate_registry_entry("VRC_X", &serde_json::json!(1.5), 100).is_ok());
        assert!(validate_registry_entry("VRC_X", &serde_json::json!(7), 99).is_err());
        assert!(validate_registry_entry("VRC_X", &serde_json::json!(7), 3).is_err());
    }

    #[test]
    fn validate_registry_json_reports_missing_fields() {
        assert!(validate_registry_json(r#"{"VRC_X":{"type":4,"data":1}}"#).is_ok());
        assert!(validate_registry_json(r#"{"VRC_X":{"data":"v"}}"#).is_err());
        assert!(validate_registry_json(r#"{"VRC_X":{"type":3}}"#).is_err());
    }

    #[test]
    fn registry_backup_json_requires_lossless_binary_byte_arrays() {
        assert!(validate_registry_json(
            r#"{"VRC_BINARY":{"type":3,"data":[0,65,128,228,184,173,255,0]}}"#
        )
        .is_ok());
        assert!(validate_registry_json(r#"{"VRC_BINARY":{"type":3,"data":"legacy"}}"#).is_err());
        assert!(validate_registry_json(r#"{"VRC_BINARY":{"type":3,"data":[256]}}"#).is_err());
        assert!(validate_registry_json(r#"{"VRC_BINARY":{"type":3,"data":[1.5]}}"#).is_err());
    }

    #[test]
    fn registry_backup_binary_data_round_trips_every_byte() {
        let bytes = [0, 65, 128, 228, 184, 173, 255, 0];

        let data = registry_backup_binary_data(&bytes);

        assert_eq!(
            registry_backup_binary_bytes("VRC_BINARY", &data).unwrap(),
            bytes
        );
    }
}
