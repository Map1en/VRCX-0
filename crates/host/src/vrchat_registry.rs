#[cfg(target_os = "windows")]
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::Error;

pub fn get_registry_key(key: &str) -> Result<serde_json::Value, Error> {
    let _ = key;

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let vrc_key = match hkcu.open_subkey("SOFTWARE\\VRChat\\VRChat") {
            Ok(k) => k,
            Err(_) => return Ok(serde_json::Value::Null),
        };

        let hashed_key = add_hash_to_key_name(key);
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

    #[cfg(target_os = "linux")]
    {
        return crate::linux_registry::get_registry_key(key).map_err(Error::Custom);
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(serde_json::Value::Null)
    }
}

pub fn get_registry_key_string(key: &str) -> Result<String, Error> {
    let val = get_registry_key(key)?;
    Ok(val.as_str().unwrap_or("").to_string())
}

pub fn has_registry_folder() -> Result<bool, Error> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        Ok(hkcu.open_subkey("SOFTWARE\\VRChat\\VRChat").is_ok())
    }
    #[cfg(target_os = "linux")]
    {
        return crate::linux_registry::has_registry_folder().map_err(Error::Custom);
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(false)
    }
}

pub fn delete_registry_folder() -> Result<(), Error> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("SOFTWARE\\VRChat") {
            let _ = key.delete_subkey_all("VRChat");
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        return crate::linux_registry::delete_registry_folder().map_err(Error::Custom);
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(())
    }
}

pub fn set_registry_key(
    key: &str,
    value: &serde_json::Value,
    type_int: i32,
) -> Result<bool, Error> {
    let _ = (key, value, type_int);

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hashed_key = add_hash_to_key_name(key);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (vrc_key, _) = hkcu
            .create_subkey("SOFTWARE\\VRChat\\VRChat")
            .map_err(|e| Error::Custom(format!("registry create: {e}")))?;

        match type_int {
            4 => {
                let dword = json_value_to_i32(value, key)?;
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_DWORD,
                            bytes: Cow::Owned(dword.to_le_bytes().to_vec()),
                        },
                    )
                    .map_err(|e| Error::Custom(format!("set dword: {e}")))?;
            }

            3 => {
                let s = value
                    .as_str()
                    .ok_or_else(|| Error::Custom(format!("registry value is not string: {key}")))?;
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_BINARY,
                            bytes: Cow::Owned(ascii_encode(s)),
                        },
                    )
                    .map_err(|e| Error::Custom(format!("set binary: {e}")))?;
            }

            100 => {
                let f = value
                    .as_f64()
                    .ok_or_else(|| Error::Custom(format!("registry value is not float: {key}")))?;
                vrc_key
                    .set_raw_value(
                        &hashed_key,
                        &winreg::RegValue {
                            vtype: REG_DWORD,
                            bytes: Cow::Owned(f.to_le_bytes().to_vec()),
                        },
                    )
                    .map_err(|e| Error::Custom(format!("set float-as-dword: {e}")))?;
            }
            _ => {
                return Err(Error::Custom(format!("unknown registry type: {type_int}")));
            }
        }
        Ok(true)
    }

    #[cfg(target_os = "linux")]
    {
        return crate::linux_registry::set_registry_key(key, value, type_int)
            .map_err(Error::Custom);
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(false)
    }
}

pub fn get_registry() -> Result<HashMap<String, HashMap<String, serde_json::Value>>, Error> {
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

    #[cfg(target_os = "linux")]
    {
        return crate::linux_registry::get_registry().map_err(Error::Custom);
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(HashMap::new())
    }
}

pub fn set_registry(json: &str) -> Result<(), Error> {
    let _ = json;

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let data: HashMap<String, HashMap<String, serde_json::Value>> = serde_json::from_str(json)?;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (vrc_key, _) = hkcu
            .create_subkey("SOFTWARE\\VRChat\\VRChat")
            .map_err(|e| Error::Custom(format!("registry create: {e}")))?;

        for (name, props) in data {
            let normalized_name = add_hash_to_key_name(&name);
            let vtype_int = props
                .get("type")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| Error::Custom(format!("unknown type: {name}")))?
                as i32;
            let value = props
                .get("data")
                .ok_or_else(|| Error::Custom(format!("missing data: {name}")))?;

            match vtype_int {
                3 => {
                    let s = value
                        .as_str()
                        .ok_or_else(|| Error::Custom(format!("invalid binary data: {name}")))?;
                    vrc_key
                        .set_raw_value(
                            &normalized_name,
                            &winreg::RegValue {
                                vtype: REG_BINARY,
                                bytes: Cow::Owned(ascii_encode(s)),
                            },
                        )
                        .map_err(|e| Error::Custom(format!("set binary: {e}")))?;
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
                        .map_err(|e| Error::Custom(format!("set dword: {e}")))?;
                }
                100 => {
                    let float_value = value
                        .as_f64()
                        .ok_or_else(|| Error::Custom(format!("invalid float data: {name}")))?;
                    vrc_key
                        .set_raw_value(
                            &normalized_name,
                            &winreg::RegValue {
                                vtype: REG_DWORD,
                                bytes: Cow::Owned(float_value.to_le_bytes().to_vec()),
                            },
                        )
                        .map_err(|e| Error::Custom(format!("set float-as-dword: {e}")))?;
                }
                _ => return Err(Error::Custom(format!("unknown type: {vtype_int}"))),
            }
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        return crate::linux_registry::set_registry(json).map_err(Error::Custom);
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(())
    }
}

pub fn read_reg_json_file(filepath: &str) -> Result<String, Error> {
    if !PathBuf::from(filepath).exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(filepath)?)
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
fn json_value_to_i32(value: &serde_json::Value, key: &str) -> Result<i32, Error> {
    let raw = value
        .as_i64()
        .ok_or_else(|| Error::Custom(format!("invalid dword data: {key}")))?;
    i32::try_from(raw).map_err(|_| Error::Custom(format!("invalid dword data: {key}")))
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
    fn handles_vrchat_registry_helpers() -> Result<(), Error> {
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
