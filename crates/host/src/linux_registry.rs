use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

const VRCHAT_APP_ID: &str = "438100";
const REGISTRY_SECTION: &str = "[Software\\\\VRChat\\\\VRChat]";

#[derive(Clone, Debug)]
pub struct LinuxRegistryContext {
    pub wine_path: PathBuf,
    pub wine_prefix: PathBuf,
    pub user_reg: PathBuf,
}

pub fn discover_linux_registry_context() -> Result<LinuxRegistryContext, String> {
    let vrchat_paths = crate::vrchat_paths::discover_linux_vrchat_paths()?;
    let user_reg = vrchat_paths.proton_prefix.join("user.reg");
    if !user_reg.is_file() {
        return Err("VRChat Proton user.reg not found".into());
    }

    let steam_roots = crate::vrchat_paths::discover_linux_steam_roots()?;
    let compat_tool = discover_vrchat_compat_tool(&steam_roots)
        .ok_or_else(|| "VRChat Proton compatibility tool not found".to_string())?;
    let wine_path = discover_wine_path(&steam_roots, &compat_tool)
        .ok_or_else(|| "VRChat Proton Wine binary not found".to_string())?;

    Ok(LinuxRegistryContext {
        wine_path,
        wine_prefix: vrchat_paths.proton_prefix,
        user_reg,
    })
}

pub fn get_registry_key(key: &str) -> Result<Value, String> {
    let context = discover_linux_registry_context()?;
    validate_registry_context(&context)?;
    let hashed_key = add_hash_to_key_name(key);
    let entries = read_registry_entries(&context.user_reg)?;
    Ok(entries
        .get(&hashed_key)
        .and_then(|raw| parse_registry_value(raw).map(|(_, data)| data))
        .unwrap_or(Value::Null))
}

pub fn has_registry_folder() -> Result<bool, String> {
    let context = discover_linux_registry_context()?;
    validate_registry_context(&context)?;
    let content = fs::read_to_string(&context.user_reg)
        .map_err(|e| format!("Failed to read Proton registry: {e}"))?;
    Ok(find_section_range(&content.lines().map(str::to_string).collect::<Vec<_>>()).is_some())
}

pub fn delete_registry_folder() -> Result<(), String> {
    let context = discover_linux_registry_context()?;
    validate_registry_context(&context)?;
    let mut lines = read_registry_lines(&context.user_reg)?;
    let Some((start, end)) = find_section_range(&lines) else {
        return Ok(());
    };
    lines.drain(start..end);
    write_registry_lines(&context.user_reg, &lines)
}

pub fn set_registry_key(key: &str, value: &Value, type_int: i32) -> Result<bool, String> {
    let context = discover_linux_registry_context()?;
    validate_registry_context(&context)?;
    let hashed_key = add_hash_to_key_name(key);
    let raw_value = format_registry_value(value, type_int)?;
    upsert_registry_value(&context.user_reg, &hashed_key, &raw_value)?;
    Ok(true)
}

pub fn get_registry() -> Result<HashMap<String, HashMap<String, Value>>, String> {
    let context = discover_linux_registry_context()?;
    validate_registry_context(&context)?;
    let entries = read_registry_entries(&context.user_reg)?;
    let mut registry = HashMap::new();

    for (key, raw) in entries {
        let Some(name) = strip_hash_from_key_name(&key) else {
            continue;
        };
        let Some((type_int, data)) = parse_registry_value(&raw) else {
            continue;
        };

        let mut entry = HashMap::new();
        entry.insert("type".to_string(), Value::from(type_int));
        entry.insert("data".to_string(), data);
        registry.insert(name.to_string(), entry);
    }

    Ok(registry)
}

pub fn set_registry(json: &str) -> Result<(), String> {
    let data: HashMap<String, HashMap<String, Value>> =
        serde_json::from_str(json).map_err(|e| format!("Invalid registry backup JSON: {e}"))?;

    for (key, props) in data {
        let type_int = props
            .get("type")
            .and_then(Value::as_i64)
            .ok_or_else(|| format!("Unknown registry type: {key}"))? as i32;
        let value = props
            .get("data")
            .ok_or_else(|| format!("Missing registry data: {key}"))?;
        set_registry_key(&key, value, type_int)?;
    }

    Ok(())
}

fn discover_vrchat_compat_tool(steam_roots: &[PathBuf]) -> Option<String> {
    for root in steam_roots {
        let config_vdf = root.join("config").join("config.vdf");
        let Ok(content) = fs::read_to_string(config_vdf) else {
            continue;
        };
        if let Some(tool) = parse_compat_tool_mapping(&content, VRCHAT_APP_ID) {
            return Some(tool);
        }
    }
    None
}

fn parse_compat_tool_mapping(content: &str, app_id: &str) -> Option<String> {
    let mut in_mapping = false;
    let mut current_app: Option<String> = None;

    for line in content.lines() {
        let tokens = quoted_tokens(line);
        if tokens
            .first()
            .is_some_and(|token| token == "CompatToolMapping")
        {
            in_mapping = true;
            current_app = None;
            continue;
        }
        if !in_mapping {
            continue;
        }
        if tokens.len() == 1 && tokens[0].bytes().all(|byte| byte.is_ascii_digit()) {
            current_app = Some(tokens[0].clone());
            continue;
        }
        if current_app.as_deref() == Some(app_id) && tokens.len() >= 2 && tokens[0] == "name" {
            let tool = tokens[1].trim();
            if !tool.is_empty() {
                return Some(tool.to_string());
            }
        }
    }

    None
}

fn validate_registry_context(context: &LinuxRegistryContext) -> Result<(), String> {
    if !context.wine_prefix.is_dir() {
        return Err("VRChat Proton prefix not found".into());
    }
    if !context.user_reg.is_file() {
        return Err("VRChat Proton user.reg not found".into());
    }
    if !context.wine_path.is_file() {
        return Err("VRChat Proton Wine binary not found".into());
    }
    Ok(())
}

fn discover_wine_path(steam_roots: &[PathBuf], compat_tool: &str) -> Option<PathBuf> {
    for root in steam_roots {
        let candidates = [
            root.join("compatibilitytools.d")
                .join(compat_tool)
                .join("files")
                .join("bin")
                .join("wine"),
            root.join("steamapps")
                .join("common")
                .join(compat_tool)
                .join("files")
                .join("bin")
                .join("wine"),
            root.join("steamapps")
                .join("common")
                .join(compat_tool)
                .join("dist")
                .join("bin")
                .join("wine"),
        ];
        for candidate in candidates {
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        let compatibilitytools = root.join("compatibilitytools.d");
        let Ok(entries) = fs::read_dir(compatibilitytools) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() || !path.to_string_lossy().contains(compat_tool) {
                continue;
            }
            let wine = path.join("files").join("bin").join("wine");
            if wine.is_file() {
                return Some(wine);
            }
        }
    }

    None
}

fn read_registry_entries(path: &Path) -> Result<HashMap<String, String>, String> {
    let lines = read_registry_lines(path)?;
    let Some((start, end)) = find_section_range(&lines) else {
        return Ok(HashMap::new());
    };

    let mut entries = HashMap::new();
    let mut index = start + 1;
    while index < end {
        let mut line = lines[index].trim().to_string();
        while line.ends_with('\\') && index + 1 < end {
            line.pop();
            index += 1;
            line.push_str(lines[index].trim());
        }

        if let Some((name, value)) = parse_registry_line(&line) {
            entries.insert(name, value);
        }
        index += 1;
    }

    Ok(entries)
}

fn read_registry_lines(path: &Path) -> Result<Vec<String>, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read Proton registry: {e}"))?;
    Ok(content.lines().map(str::to_string).collect())
}

fn write_registry_lines(path: &Path, lines: &[String]) -> Result<(), String> {
    fs::write(path, format!("{}\n", lines.join("\n")))
        .map_err(|e| format!("Failed to write Proton registry: {e}"))
}

fn find_section_range(lines: &[String]) -> Option<(usize, usize)> {
    let start = lines
        .iter()
        .position(|line| is_vrchat_registry_section(line))?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| is_registry_section(line).then_some(index))
        .unwrap_or(lines.len());
    Some((start, end))
}

fn is_vrchat_registry_section(line: &str) -> bool {
    let trimmed = line.trim();
    if !trimmed.starts_with(REGISTRY_SECTION) {
        return false;
    }
    trimmed[REGISTRY_SECTION.len()..]
        .chars()
        .next()
        .is_none_or(char::is_whitespace)
}

fn is_registry_section(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('[') && trimmed.contains(']')
}

fn parse_registry_line(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix('"')?;
    let (name, value) = rest.split_once("\"=")?;
    Some((name.to_string(), value.trim().to_string()))
}

fn parse_registry_value(value: &str) -> Option<(i32, Value)> {
    if let Some(hex) = value.strip_prefix("dword:") {
        let raw = u32::from_str_radix(hex.trim(), 16).ok()?;
        return Some((4, Value::from(raw as i32)));
    }

    if let Some(hex) = value.strip_prefix("hex(4):") {
        let bytes = parse_hex_bytes(hex)?;
        if bytes.len() == 8 {
            let parsed = f64::from_le_bytes(bytes.try_into().ok()?);
            return Some((100, Value::from(parsed)));
        }
        if bytes.len() >= 4 {
            let parsed = i32::from_le_bytes(bytes[0..4].try_into().ok()?);
            return Some((4, Value::from(parsed)));
        }
        return None;
    }

    if let Some(hex) = value.strip_prefix("hex:") {
        let bytes = parse_hex_bytes(hex)?;
        return Some((3, Value::from(ascii_decode(&bytes))));
    }

    None
}

fn parse_hex_bytes(value: &str) -> Option<Vec<u8>> {
    value
        .split(',')
        .filter(|part| !part.trim().is_empty())
        .map(|part| u8::from_str_radix(part.trim(), 16).ok())
        .collect()
}

fn format_registry_value(value: &Value, type_int: i32) -> Result<String, String> {
    match type_int {
        3 => {
            let bytes = if let Some(value) = value.as_str() {
                ascii_encode(value)
            } else if let Some(values) = value.as_array() {
                values
                    .iter()
                    .map(|item| {
                        item.as_u64()
                            .and_then(|value| u8::try_from(value).ok())
                            .ok_or_else(|| "Invalid binary registry data".to_string())
                    })
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                return Err("Invalid binary registry data".into());
            };
            Ok(format!("hex:{}", format_hex_bytes(&bytes)))
        }
        4 => {
            let raw = json_value_to_i32(value)?;
            Ok(format!("dword:{:08x}", raw as u32))
        }
        100 => {
            let raw = value
                .as_f64()
                .ok_or_else(|| "Invalid float registry data".to_string())?;
            Ok(format!("hex(4):{}", format_hex_bytes(&raw.to_le_bytes())))
        }
        _ => Err(format!("Unknown registry type: {type_int}")),
    }
}

fn upsert_registry_value(path: &Path, name: &str, raw_value: &str) -> Result<(), String> {
    let mut lines = read_registry_lines(path)?;
    let value_line = format!("\"{name}\"={raw_value}");

    if let Some((start, end)) = find_section_range(&lines) {
        for line in lines.iter_mut().take(end).skip(start + 1) {
            if line.trim_start().starts_with(&format!("\"{name}\"=")) {
                *line = value_line;
                return write_registry_lines(path, &lines);
            }
        }
        lines.insert(start + 1, value_line);
    } else {
        if !lines.last().is_none_or(|line| line.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push(REGISTRY_SECTION.to_string());
        lines.push(value_line);
    }

    write_registry_lines(path, &lines)
}

fn json_value_to_i32(value: &Value) -> Result<i32, String> {
    if let Some(raw) = value.as_i64() {
        return i32::try_from(raw).map_err(|_| "Invalid dword registry data".to_string());
    }
    if let Some(raw) = value.as_str() {
        return raw
            .parse::<i32>()
            .map_err(|_| "Invalid dword registry data".to_string());
    }
    Err("Invalid dword registry data".into())
}

fn add_hash_to_key_name(key: &str) -> String {
    let mut hash: u32 = 5381;
    for unit in key.encode_utf16() {
        hash = hash.wrapping_mul(33) ^ unit as u32;
    }
    format!("{key}_h{hash}")
}

fn strip_hash_from_key_name(key: &str) -> Option<&str> {
    let (prefix, suffix) = key.rsplit_once("_h")?;
    if !suffix.is_empty() && !prefix.is_empty() {
        Some(prefix)
    } else {
        None
    }
}

fn ascii_decode(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| if byte.is_ascii() { *byte as char } else { '?' })
        .collect()
}

fn ascii_encode(value: &str) -> Vec<u8> {
    value
        .chars()
        .map(|ch| if ch.is_ascii() { ch as u8 } else { b'?' })
        .collect()
}

fn format_hex_bytes(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn quoted_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    let mut escaped = false;

    for ch in line.chars() {
        if !in_quote {
            if ch == '"' {
                in_quote = true;
                current.clear();
            }
            continue;
        }

        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' => {
                in_quote = false;
                tokens.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    tokens
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        discover_wine_path, find_section_range, format_registry_value, is_vrchat_registry_section,
        parse_compat_tool_mapping, parse_registry_value,
    };

    #[test]
    fn parses_vrchat_compat_tool_mapping() {
        let content = r#"
            "CompatToolMapping"
            {
                "438100"
                {
                    "name" "GE-Proton9-27"
                }
            }
        "#;
        assert_eq!(
            parse_compat_tool_mapping(content, "438100").as_deref(),
            Some("GE-Proton9-27")
        );
    }

    #[test]
    fn parses_registry_value_shapes() {
        assert_eq!(
            parse_registry_value("dword:ffffffff").map(|(_, value)| value),
            Some(serde_json::json!(-1))
        );
        assert_eq!(
            parse_registry_value("hex:41,42,ff").map(|(_, value)| value),
            Some(serde_json::json!("AB?"))
        );
    }

    #[test]
    fn formats_registry_value_shapes() {
        assert_eq!(
            format_registry_value(&serde_json::json!(-1), 4).as_deref(),
            Ok("dword:ffffffff")
        );
        assert_eq!(
            format_registry_value(&serde_json::json!("ABé"), 3).as_deref(),
            Ok("hex:41,42,3f")
        );
    }

    #[test]
    fn matches_wine_registry_sections_with_timestamps() {
        assert!(is_vrchat_registry_section(
            "[Software\\\\VRChat\\\\VRChat] 1715753421"
        ));
        let lines = vec![
            "WINE REGISTRY Version 2".to_string(),
            "[Software\\\\VRChat\\\\VRChat] 1715753421".to_string(),
            "#time=1dabc".to_string(),
            "\"LOGGING_ENABLED_h123\"=dword:00000001".to_string(),
            "[Software\\\\Other] 1715753422".to_string(),
        ];
        assert_eq!(find_section_range(&lines), Some((1, 4)));
    }

    #[test]
    fn discovers_modern_proton_wine_layout() {
        let root = std::env::temp_dir().join(format!(
            "vrcx-linux-registry-test-{}-modern-proton",
            std::process::id()
        ));
        let wine = root
            .join("steamapps")
            .join("common")
            .join("Proton Hotfix")
            .join("files")
            .join("bin")
            .join("wine");
        fs::create_dir_all(wine.parent().unwrap()).unwrap();
        fs::write(&wine, b"").unwrap();

        assert_eq!(
            discover_wine_path(&[root.clone()], "Proton Hotfix"),
            Some(wine)
        );

        fs::remove_dir_all(root).unwrap();
    }
}
