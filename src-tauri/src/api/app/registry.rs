#![allow(non_snake_case)]

#[cfg(target_os = "windows")]
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::AppError;

#[tauri::command]
pub fn app__get_vrchat_registry_key(key: String) -> Result<serde_json::Value, AppError> {
    #[cfg(not(target_os = "windows"))]
    let _ = &key;

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let vrc_key = match hkcu.open_subkey("SOFTWARE\\VRChat\\VRChat") {
            Ok(k) => k,
            Err(_) => return Ok(serde_json::Value::Null),
        };

        let hashed_key = add_hash_to_key_name(&key);
        if let Ok(val) = vrc_key.get_raw_value(&hashed_key) {
            match val.vtype {
                REG_BINARY => {
                    let s = ascii_decode(&val.bytes);
                    return Ok(serde_json::Value::String(s));
                }
                REG_DWORD => {
                    if val.bytes.len() >= 8 {
                        let float_value = f64::from_le_bytes([
                            val.bytes[0],
                            val.bytes[1],
                            val.bytes[2],
                            val.bytes[3],
                            val.bytes[4],
                            val.bytes[5],
                            val.bytes[6],
                            val.bytes[7],
                        ]);
                        return Ok(serde_json::json!(float_value));
                    }
                    if val.bytes.len() >= 4 {
                        let dword = i32::from_le_bytes([
                            val.bytes[0],
                            val.bytes[1],
                            val.bytes[2],
                            val.bytes[3],
                        ]);
                        return Ok(serde_json::json!(dword));
                    }
                }
                _ => {}
            }
        }
        Ok(serde_json::Value::Null)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(serde_json::Value::Null)
    }
}

#[tauri::command]
pub fn app__get_vrchat_registry_key_string(key: String) -> Result<String, AppError> {
    let val = app__get_vrchat_registry_key(key)?;
    Ok(val.as_str().unwrap_or("").to_string())
}

#[tauri::command]
pub fn app__has_vrchat_registry_folder() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey("SOFTWARE\\VRChat\\VRChat").is_ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
pub fn app__delete_vrchat_registry_folder() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("SOFTWARE\\VRChat") {
            let _ = key.delete_subkey_all("VRChat");
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app__set_vrchat_registry_key(
    _key: String,
    _value: serde_json::Value,
    _type_int: i32,
) -> Result<bool, AppError> {
    #[cfg(target_os = "windows")]
    {
        let key = _key;
        let value = _value;
        let type_int = _type_int;
        use winreg::enums::*;
        use winreg::RegKey;

        let hashed_key = add_hash_to_key_name(&key);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (vrc_key, _) = hkcu
            .create_subkey("SOFTWARE\\VRChat\\VRChat")
            .map_err(|e| AppError::Custom(format!("registry create: {e}")))?;

        match type_int {
            4 => {
                let dword = json_value_to_i32(&value, &key)?;
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_DWORD,
                            bytes: Cow::Owned(dword.to_le_bytes().to_vec()),
                        },
                    )
                    .map_err(|e| AppError::Custom(format!("set dword: {e}")))?;
            }

            3 => {
                let s = value.as_str().ok_or_else(|| {
                    AppError::Custom(format!("registry value is not string: {key}"))
                })?;
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_BINARY,
                            bytes: Cow::Owned(ascii_encode(s)),
                        },
                    )
                    .map_err(|e| AppError::Custom(format!("set binary: {e}")))?;
            }

            100 => {
                let f = value.as_f64().ok_or_else(|| {
                    AppError::Custom(format!("registry value is not float: {key}"))
                })?;
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_DWORD,
                            bytes: Cow::Owned(f.to_le_bytes().to_vec()),
                        },
                    )
                    .map_err(|e| AppError::Custom(format!("set float-as-dword: {e}")))?;
            }
            _ => {
                return Err(AppError::Custom(format!(
                    "unknown registry type: {type_int}"
                )));
            }
        }
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub fn app__get_vrchat_registry(
) -> Result<HashMap<String, HashMap<String, serde_json::Value>>, AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let vrc_key = match hkcu.open_subkey("SOFTWARE\\VRChat\\VRChat") {
            Ok(k) => k,
            Err(_) => return Ok(HashMap::new()),
        };

        let mut result = HashMap::new();
        for name in vrc_key.enum_values().flatten().map(|(name, _)| name) {
            if let Ok(val) = vrc_key.get_raw_value(&name) {
                let Some(key_name) = strip_hash_from_key_name(&name) else {
                    continue;
                };
                let mut entry = HashMap::new();
                match val.vtype {
                    REG_BINARY => {
                        let s = ascii_decode(&val.bytes);
                        entry.insert("type".to_string(), serde_json::json!(3));
                        entry.insert("data".to_string(), serde_json::json!(s));
                    }
                    REG_DWORD => {
                        if val.bytes.len() >= 8 {
                            let float_value = f64::from_le_bytes([
                                val.bytes[0],
                                val.bytes[1],
                                val.bytes[2],
                                val.bytes[3],
                                val.bytes[4],
                                val.bytes[5],
                                val.bytes[6],
                                val.bytes[7],
                            ]);
                            entry.insert("type".to_string(), serde_json::json!(100));
                            entry.insert("data".to_string(), serde_json::json!(float_value));
                        } else if val.bytes.len() >= 4 {
                            let dword = i32::from_le_bytes([
                                val.bytes[0],
                                val.bytes[1],
                                val.bytes[2],
                                val.bytes[3],
                            ]);
                            entry.insert("type".to_string(), serde_json::json!(4));
                            entry.insert("data".to_string(), serde_json::json!(dword));
                        }
                    }
                    _ => continue,
                }
                result.insert(key_name.to_string(), entry);
            }
        }
        Ok(result)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(HashMap::new())
    }
}

#[tauri::command]
pub fn app__set_vrchat_registry(_json: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let json = _json;
        use winreg::enums::*;
        use winreg::RegKey;

        let data: HashMap<String, HashMap<String, serde_json::Value>> =
            serde_json::from_str(&json)?;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (vrc_key, _) = hkcu
            .create_subkey("SOFTWARE\\VRChat\\VRChat")
            .map_err(|e| AppError::Custom(format!("registry create: {e}")))?;

        for (name, props) in data {
            let normalized_name = add_hash_to_key_name(&name);
            let vtype_int = props
                .get("type")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| AppError::Custom(format!("unknown type: {name}")))?
                as i32;
            let value = props
                .get("data")
                .ok_or_else(|| AppError::Custom(format!("missing data: {name}")))?;

            match vtype_int {
                3 => {
                    let s = value
                        .as_str()
                        .ok_or_else(|| AppError::Custom(format!("invalid binary data: {name}")))?;
                    vrc_key
                        .set_raw_value(
                            &normalized_name,
                            &winreg::RegValue {
                                vtype: REG_BINARY,
                                bytes: Cow::Owned(ascii_encode(s)),
                            },
                        )
                        .map_err(|e| AppError::Custom(format!("set binary: {e}")))?;
                }
                4 => {
                    let dword = json_value_to_i32(value, &name)?;
                    vrc_key
                        .set_raw_value(
                            &normalized_name,
                            &winreg::RegValue {
                                vtype: REG_DWORD,
                                bytes: Cow::Owned(dword.to_le_bytes().to_vec()),
                            },
                        )
                        .map_err(|e| AppError::Custom(format!("set dword: {e}")))?;
                }
                100 => {
                    let float_value = value
                        .as_f64()
                        .ok_or_else(|| AppError::Custom(format!("invalid float data: {name}")))?;
                    vrc_key
                        .set_raw_value(
                            &normalized_name,
                            &winreg::RegValue {
                                vtype: REG_DWORD,
                                bytes: Cow::Owned(float_value.to_le_bytes().to_vec()),
                            },
                        )
                        .map_err(|e| AppError::Custom(format!("set float-as-dword: {e}")))?;
                }
                _ => return Err(AppError::Custom(format!("unknown type: {vtype_int}"))),
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app__read_vrc_reg_json_file(filepath: String) -> Result<String, AppError> {
    if !PathBuf::from(&filepath).exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(&filepath)?)
}

#[cfg(target_os = "windows")]
fn add_hash_to_key_name(key: &str) -> String {
    let mut hash: u32 = 5381;
    for unit in key.encode_utf16() {
        hash = hash.wrapping_mul(33) ^ unit as u32;
    }
    format!("{key}_h{hash}")
}

#[cfg(target_os = "windows")]
fn ascii_decode(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| if byte.is_ascii() { *byte as char } else { '?' })
        .collect()
}

#[cfg(target_os = "windows")]
fn ascii_encode(value: &str) -> Vec<u8> {
    value
        .chars()
        .map(|ch| if ch.is_ascii() { ch as u8 } else { b'?' })
        .collect()
}

#[cfg(target_os = "windows")]
fn json_value_to_i32(value: &serde_json::Value, key: &str) -> Result<i32, AppError> {
    let raw = value
        .as_i64()
        .ok_or_else(|| AppError::Custom(format!("invalid dword data: {key}")))?;
    i32::try_from(raw).map_err(|_| AppError::Custom(format!("invalid dword data: {key}")))
}

#[cfg(target_os = "windows")]
fn strip_hash_from_key_name(key: &str) -> Option<&str> {
    let (prefix, suffix) = key.rsplit_once("_h")?;
    if !suffix.is_empty() && !prefix.is_empty() {
        Some(prefix)
    } else {
        None
    }
}
#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn handles_vrchat_registry_helpers() -> Result<(), AppError> {
        assert_eq!(
            add_hash_to_key_name("playerHeight"),
            "playerHeight_h56066313"
        );
        assert_eq!(ascii_encode("abc\u{00e9}"), b"abc?".to_vec());
        assert_eq!(ascii_decode(b"abc\xff"), "abc?");
        assert_eq!(
            strip_hash_from_key_name("playerHeight_h56066313"),
            Some("playerHeight")
        );
        assert_eq!(strip_hash_from_key_name("_h56066313"), None);
        assert_eq!(strip_hash_from_key_name("playerHeight_h"), None);

        assert_eq!(json_value_to_i32(&serde_json::json!(42), "height")?, 42);
        assert!(json_value_to_i32(&serde_json::json!(2147483648i64), "height").is_err());
        assert!(json_value_to_i32(&serde_json::json!("42"), "height").is_err());
        Ok(())
    }
}
