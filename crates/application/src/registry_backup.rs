use std::collections::HashMap;

use chrono::{Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_persistence::config;
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result};

const CONFIG_AUTO_BACKUP: &str = "vrcRegistryAutoBackup";
const CONFIG_ASK_RESTORE: &str = "vrcRegistryAskRestore";
const CONFIG_BACKUPS: &str = "VRChatRegistryBackups";
const CONFIG_LAST_BACKUP_DATE: &str = "VRChatRegistryLastBackupDate";
const CONFIG_LAST_RESTORE_CHECK: &str = "VRChatRegistryLastRestoreCheck";

const AUTO_BACKUP_NAME: &str = "Auto Backup";
const MANUAL_BACKUP_NAME: &str = "Manual Backup";
const AUTO_BACKUP_INTERVAL_DAYS: i64 = 3;
const AUTO_BACKUP_RETENTION_DAYS: i64 = 14;

const ALLOWED_REGISTRY_TYPES: [i32; 3] = [3, 4, 100];
const ALLOWED_REGISTRY_KEYS: [&str; 2] = ["LOGGING_ENABLED", "VRC_DEBUG_LOGGING"];
const ALLOWED_REGISTRY_KEY_PREFIXES: [&str; 8] = [
    "VRC_",
    "VRChat_",
    "vrchat_",
    "Screenmanager ",
    "UnityGraphicsQuality",
    "UnitySelectMonitor",
    "unity.",
    "PlayerPrefs_",
];

pub trait RegistryBackupHostActions: Send + Sync {
    fn has_registry_folder(&self) -> Result<bool>;
    fn get_registry(&self) -> Result<Value>;
    fn set_registry_json(&self, json: &str) -> Result<()>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegistryBackupMaintenanceMode {
    Foreground,
    Silent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryBackupSnapshot {
    pub key: String,
    pub name: String,
    pub date: String,
    pub data: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryBackupMaintenanceResult {
    pub backups: Vec<RegistryBackupSnapshot>,
    pub auto_backup_created: bool,
    pub restore_prompt_needed: bool,
    pub restore_prompt_backup_date: Option<String>,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredRegistryBackup {
    #[serde(default)]
    name: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    data: Value,
}

pub fn registry_backup_list(db: &DatabaseService) -> Result<Vec<RegistryBackupSnapshot>> {
    Ok(read_backups(db)?
        .iter()
        .enumerate()
        .map(|(index, backup)| normalize_backup(backup, index))
        .collect())
}

pub fn registry_backup_create(
    db: &DatabaseService,
    host: &dyn RegistryBackupHostActions,
    name: &str,
) -> Result<Vec<RegistryBackupSnapshot>> {
    create_backup(db, host, normalized_backup_name(name), Utc::now())?;
    registry_backup_list(db)
}

pub fn registry_backup_restore(
    db: &DatabaseService,
    host: &dyn RegistryBackupHostActions,
    key: &str,
) -> Result<RegistryBackupSnapshot> {
    let backups = read_backups(db)?;
    let Some((index, backup)) = backups
        .iter()
        .enumerate()
        .find(|(index, backup)| normalize_backup(backup, *index).key == key)
    else {
        return Err(Error::Custom("Registry backup not found.".into()));
    };

    let json = registry_backup_data_to_json(&backup.data)?;
    validate_registry_json(&json)?;
    host.set_registry_json(&json)?;
    config::set_string(
        db,
        CONFIG_LAST_RESTORE_CHECK,
        &non_empty_or_now(&backup.date),
    )?;
    Ok(normalize_backup(backup, index))
}

pub fn registry_backup_delete(
    db: &DatabaseService,
    key: &str,
) -> Result<Vec<RegistryBackupSnapshot>> {
    let backups = read_backups(db)?;
    let mut removed = false;
    let next_backups = backups
        .into_iter()
        .enumerate()
        .filter_map(|(index, backup)| {
            if normalize_backup(&backup, index).key == key {
                removed = true;
                None
            } else {
                Some(backup)
            }
        })
        .collect::<Vec<_>>();
    if !removed {
        return Err(Error::Custom("Registry backup not found.".into()));
    }
    write_backups(db, &next_backups)?;
    registry_backup_list(db)
}

pub fn registry_backup_export_json(db: &DatabaseService, key: &str) -> Result<String> {
    let backups = read_backups(db)?;
    let Some(backup) = backups
        .iter()
        .enumerate()
        .find_map(|(index, backup)| (normalize_backup(backup, index).key == key).then_some(backup))
    else {
        return Err(Error::Custom("Registry backup not found.".into()));
    };
    let json = registry_backup_data_to_json(&backup.data)?;
    let parsed = serde_json::from_str::<Value>(&json)?;
    serde_json::to_string_pretty(&parsed).map_err(Error::from)
}

pub fn registry_backup_import_json(
    db: &DatabaseService,
    host: &dyn RegistryBackupHostActions,
    json: &str,
) -> Result<()> {
    validate_registry_json(json)?;
    host.set_registry_json(json)?;
    config::set_string(db, CONFIG_LAST_RESTORE_CHECK, &now_iso())?;
    Ok(())
}

pub fn registry_backup_maintenance_run(
    db: &DatabaseService,
    host: &dyn RegistryBackupHostActions,
    mode: RegistryBackupMaintenanceMode,
    reason: &str,
) -> Result<RegistryBackupMaintenanceResult> {
    let auto_backup_enabled = config::get_bool(db, CONFIG_AUTO_BACKUP, true)?;
    if !auto_backup_enabled {
        return maintenance_result(db, false, false, None, "Registry auto backup is disabled.");
    }

    let mut backups = read_backups(db)?;
    let now = Utc::now();
    let pruned = prune_old_auto_backups(&mut backups, now);
    if pruned {
        write_backups(db, &backups)?;
    }

    let has_registry_folder = host.has_registry_folder()?;
    if !has_registry_folder {
        return maybe_restore_prompt(db, mode);
    }

    if recent_auto_backup_exists(db, now)? {
        let detail =
            format!("Registry backup maintenance skipped; recent backup exists ({reason}).");
        return maintenance_result(db, false, false, None, detail);
    }

    match create_backup(db, host, AUTO_BACKUP_NAME.into(), now) {
        Ok(()) => {
            config::set_string(db, CONFIG_LAST_BACKUP_DATE, &now_iso_from(now))?;
            let detail = format!("Registry auto backup created ({reason}).");
            maintenance_result(db, true, false, None, detail)
        }
        Err(Error::Custom(message))
            if message == "No VRChat registry data was found to back up." =>
        {
            maintenance_result(
                db,
                false,
                false,
                None,
                "Registry auto backup skipped; no registry data was found.",
            )
        }
        Err(error) => Err(error),
    }
}

fn read_backups(db: &DatabaseService) -> Result<Vec<StoredRegistryBackup>> {
    let raw = config::get_json(db, CONFIG_BACKUPS, json!([]))?;
    Ok(match raw {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| serde_json::from_value::<StoredRegistryBackup>(item).ok())
            .collect(),
        Value::String(raw) => {
            serde_json::from_str::<Vec<StoredRegistryBackup>>(&raw).unwrap_or_default()
        }
        _ => Vec::new(),
    })
}

fn write_backups(db: &DatabaseService, backups: &[StoredRegistryBackup]) -> Result<()> {
    let value = serde_json::to_value(backups)?;
    config::set_json(db, CONFIG_BACKUPS, &value)?;
    Ok(())
}

fn create_backup(
    db: &DatabaseService,
    host: &dyn RegistryBackupHostActions,
    name: String,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    let data = host.get_registry()?;
    if data.as_object().is_none_or(|object| object.is_empty()) {
        return Err(Error::Custom(
            "No VRChat registry data was found to back up.".into(),
        ));
    }

    let mut backups = read_backups(db)?;
    backups.push(StoredRegistryBackup {
        name,
        date: now_iso_from(now),
        data,
    });
    write_backups(db, &backups)?;
    Ok(())
}

fn prune_old_auto_backups(
    backups: &mut Vec<StoredRegistryBackup>,
    now: chrono::DateTime<Utc>,
) -> bool {
    let before = backups.len();
    let cutoff = now - Duration::days(AUTO_BACKUP_RETENTION_DAYS);
    backups.retain(|backup| {
        if backup.name != AUTO_BACKUP_NAME {
            return true;
        }
        parse_backup_date(&backup.date).is_some_and(|date| date >= cutoff)
    });
    backups.len() != before
}

fn recent_auto_backup_exists(db: &DatabaseService, now: chrono::DateTime<Utc>) -> Result<bool> {
    let last_backup_date = config::get_string(db, CONFIG_LAST_BACKUP_DATE, "")?;
    let Some(last_backup_date) = parse_backup_date(&last_backup_date) else {
        return Ok(false);
    };
    Ok(now - last_backup_date < Duration::days(AUTO_BACKUP_INTERVAL_DAYS))
}

fn maybe_restore_prompt(
    db: &DatabaseService,
    mode: RegistryBackupMaintenanceMode,
) -> Result<RegistryBackupMaintenanceResult> {
    if mode != RegistryBackupMaintenanceMode::Foreground {
        return maintenance_result(
            db,
            false,
            false,
            None,
            "Registry folder is missing; silent maintenance does not prompt.",
        );
    }
    if !config::get_bool(db, CONFIG_ASK_RESTORE, true)? {
        return maintenance_result(
            db,
            false,
            false,
            None,
            "Registry folder is missing; restore prompt is disabled.",
        );
    }
    let last_backup_date = config::get_string(db, CONFIG_LAST_BACKUP_DATE, "")?;
    let last_restore_check = config::get_string(db, CONFIG_LAST_RESTORE_CHECK, "")?;
    if last_backup_date.trim().is_empty() || last_restore_check == last_backup_date {
        return maintenance_result(
            db,
            false,
            false,
            None,
            "Registry folder is missing; no restore prompt is due.",
        );
    }
    maintenance_result(
        db,
        false,
        true,
        Some(last_backup_date),
        "Registry restore prompt is needed.",
    )
}

fn maintenance_result(
    db: &DatabaseService,
    auto_backup_created: bool,
    restore_prompt_needed: bool,
    restore_prompt_backup_date: Option<String>,
    detail: impl Into<String>,
) -> Result<RegistryBackupMaintenanceResult> {
    Ok(RegistryBackupMaintenanceResult {
        backups: registry_backup_list(db)?,
        auto_backup_created,
        restore_prompt_needed,
        restore_prompt_backup_date,
        detail: detail.into(),
    })
}

fn normalize_backup(backup: &StoredRegistryBackup, index: usize) -> RegistryBackupSnapshot {
    let name = if backup.name.trim().is_empty() {
        "Backup".into()
    } else {
        backup.name.clone()
    };
    let date = backup.date.clone();
    let key = format!(
        "{}-{}",
        if date.trim().is_empty() {
            index.to_string()
        } else {
            date.clone()
        },
        if backup.name.trim().is_empty() {
            "backup".into()
        } else {
            backup.name.clone()
        }
    );
    RegistryBackupSnapshot {
        key,
        name,
        date,
        data: backup.data.clone(),
    }
}

fn registry_backup_data_to_json(data: &Value) -> Result<String> {
    if let Some(raw) = data.as_str() {
        validate_registry_json(raw)?;
        return Ok(raw.to_string());
    }
    serde_json::to_string(data).map_err(Error::from)
}

fn validate_registry_json(raw: &str) -> Result<()> {
    let data: HashMap<String, HashMap<String, Value>> = serde_json::from_str(raw)?;
    for (key, props) in data {
        let type_int = props
            .get("type")
            .and_then(Value::as_i64)
            .ok_or_else(|| Error::Custom(format!("Invalid registry type for {key}")))?;
        let type_int = i32::try_from(type_int)
            .map_err(|_| Error::Custom(format!("Invalid registry type for {key}")))?;
        let value = props
            .get("data")
            .ok_or_else(|| Error::Custom(format!("Missing registry data for {key}")))?;
        validate_registry_entry(&key, value, type_int)?;
    }
    Ok(())
}

fn validate_registry_entry(key: &str, value: &Value, type_int: i32) -> Result<()> {
    validate_registry_key(key)?;
    if !ALLOWED_REGISTRY_TYPES.contains(&type_int) {
        return Err(Error::Custom(format!(
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
        3 | 4 | 100 => Err(Error::Custom(format!(
            "Invalid registry value shape for {key}."
        ))),
        _ => unreachable!("registry type allow-list is checked before value validation"),
    }
}

fn validate_registry_key(key: &str) -> Result<()> {
    let key = key.trim();
    if key.is_empty() || key.len() > 128 {
        return Err(Error::Custom("Invalid VRChat registry key.".into()));
    }

    let allowed = key.bytes().all(|byte| {
        (byte == b' ' || byte.is_ascii_graphic()) && !matches!(byte, b'\\' | b'/' | b'"' | b'\'')
    });
    if !allowed {
        return Err(Error::Custom(format!(
            "VRChat registry key '{key}' contains unsupported characters."
        )));
    }

    if !is_allowed_registry_key(key) {
        return Err(Error::Custom(format!(
            "VRChat registry key '{key}' is not in the allowed PlayerPrefs set."
        )));
    }

    Ok(())
}

fn is_allowed_registry_key(key: &str) -> bool {
    ALLOWED_REGISTRY_KEYS.contains(&key)
        || ALLOWED_REGISTRY_KEY_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix))
        || is_unity_player_prefs_name(key)
        || is_unity_player_prefs_key(key)
}

fn is_unity_player_prefs_key(key: &str) -> bool {
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

fn normalized_backup_name(name: &str) -> String {
    let name = name.trim();
    if name.is_empty() {
        MANUAL_BACKUP_NAME.into()
    } else {
        name.into()
    }
}

fn non_empty_or_now(value: &str) -> String {
    if value.trim().is_empty() {
        now_iso()
    } else {
        value.to_string()
    }
}

fn now_iso() -> String {
    now_iso_from(Utc::now())
}

fn now_iso_from(now: chrono::DateTime<Utc>) -> String {
    now.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_backup_date(value: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}
