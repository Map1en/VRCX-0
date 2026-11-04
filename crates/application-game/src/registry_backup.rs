use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{Error, Result};
use vrcx_0_application_core::ConfigStore;
use vrcx_0_core::time::{iso_millis, now_iso};

const CONFIG_AUTO_BACKUP: &str = "vrcRegistryAutoBackup";
const CONFIG_ASK_RESTORE: &str = "vrcRegistryAskRestore";
const CONFIG_BACKUPS: &str = "VRChatRegistryBackups";
const CONFIG_LAST_BACKUP_DATE: &str = "VRChatRegistryLastBackupDate";
const CONFIG_LAST_RESTORE_CHECK: &str = "VRChatRegistryLastRestoreCheck";

const AUTO_BACKUP_NAME: &str = "Auto Backup";
const MANUAL_BACKUP_NAME: &str = "Manual Backup";
const NO_REGISTRY_DATA_MESSAGE: &str = "No VRChat registry data was found to back up.";
const AUTO_BACKUP_INTERVAL: Duration = Duration::days(3);
const AUTO_BACKUP_RETENTION: Duration = Duration::days(14);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CreateBackupOutcome {
    Created,
    NoRegistryData,
}

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

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RegistryBackupSnapshot {
    pub key: String,
    pub name: String,
    pub date: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryBackupExport {
    pub file_name: String,
    pub json: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RegistryBackupMaintenanceResult {
    pub auto_backup_created: bool,
    pub restore_prompt_needed: bool,
    pub restore_prompt_backup_date: Option<String>,
    #[serde(skip)]
    #[specta(skip)]
    pub restore_prompt_check_deferred: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
struct StoredRegistryBackup {
    #[serde(default)]
    name: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    data: Value,
}

pub fn registry_backup_list(config: &dyn ConfigStore) -> Result<Vec<RegistryBackupSnapshot>> {
    Ok(read_backups(config)?
        .into_iter()
        .enumerate()
        .map(|(index, backup)| normalize_backup(backup, index))
        .collect())
}

pub fn registry_backup_create(
    config: &dyn ConfigStore,
    host: &dyn RegistryBackupHostActions,
    name: &str,
) -> Result<Vec<RegistryBackupSnapshot>> {
    match create_backup(config, host, normalized_backup_name(name), Utc::now())? {
        CreateBackupOutcome::Created => registry_backup_list(config),
        CreateBackupOutcome::NoRegistryData => Err(Error::Custom(NO_REGISTRY_DATA_MESSAGE.into())),
    }
}

pub fn registry_backup_restore(
    config: &dyn ConfigStore,
    host: &dyn RegistryBackupHostActions,
    key: &str,
) -> Result<RegistryBackupSnapshot> {
    let backups = read_backups(config)?;
    let Some((index, backup)) = backups
        .into_iter()
        .enumerate()
        .find(|(index, backup)| backup_key(backup, *index) == key)
    else {
        return Err(Error::Custom("Registry backup not found.".into()));
    };

    let json = registry_backup_data_to_json(&backup.data)?;
    validate_registry_json(&json)?;
    host.set_registry_json(&json)?;
    config.set_string(CONFIG_LAST_RESTORE_CHECK, &non_empty_or_now(&backup.date))?;
    Ok(normalize_backup(backup, index))
}

pub fn registry_backup_delete(
    config: &dyn ConfigStore,
    key: &str,
) -> Result<Vec<RegistryBackupSnapshot>> {
    let backups = read_backups(config)?;
    let mut removed = false;
    let next_backups = backups
        .into_iter()
        .enumerate()
        .filter_map(|(index, backup)| {
            if backup_key(&backup, index) == key {
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
    write_backups(config, &next_backups)?;
    registry_backup_list(config)
}

pub fn registry_backup_prepare_export(
    config: &dyn ConfigStore,
    key: &str,
) -> Result<RegistryBackupExport> {
    let backups = read_backups(config)?;
    let Some(backup) = backups
        .into_iter()
        .enumerate()
        .find_map(|(index, backup)| (backup_key(&backup, index) == key).then_some(backup))
    else {
        return Err(Error::Custom("Registry backup not found.".into()));
    };
    let json = registry_backup_data_to_json(&backup.data)?;
    let parsed = serde_json::from_str::<Value>(&json)?;
    let json = serde_json::to_string_pretty(&parsed)?;
    let name = backup.name.trim();
    let name = if name.is_empty() {
        "VRChat Registry Backup"
    } else {
        name
    };
    Ok(RegistryBackupExport {
        file_name: format!("{name}.json"),
        json,
    })
}

pub fn registry_backup_import_json(
    config: &dyn ConfigStore,
    host: &dyn RegistryBackupHostActions,
    json: &str,
) -> Result<()> {
    validate_registry_json(json)?;
    host.set_registry_json(json)?;
    config.set_string(CONFIG_LAST_RESTORE_CHECK, &now_iso())?;
    Ok(())
}

pub fn registry_backup_restore_prompt_acknowledge(
    config: &dyn ConfigStore,
    backup_date: &str,
) -> Result<String> {
    config.set_string(CONFIG_LAST_RESTORE_CHECK, backup_date)?;
    Ok(backup_date.to_string())
}

pub fn registry_backup_maintenance_run(
    config: &dyn ConfigStore,
    host: &dyn RegistryBackupHostActions,
    mode: RegistryBackupMaintenanceMode,
    reason: &str,
) -> Result<RegistryBackupMaintenanceResult> {
    let auto_backup_enabled = config.get_bool(CONFIG_AUTO_BACKUP, true)?;
    if !auto_backup_enabled {
        return maintenance_result(
            false,
            false,
            None,
            false,
            "Registry auto backup is disabled.",
        );
    }

    let mut backups = read_backups(config)?;
    let now = Utc::now();
    let pruned = prune_old_auto_backups(&mut backups, now);
    if pruned {
        write_backups(config, &backups)?;
    }

    let has_registry_folder = host.has_registry_folder()?;
    if !has_registry_folder {
        return maybe_restore_prompt(config, mode);
    }

    if recent_auto_backup_exists(config, now)? {
        let detail =
            format!("Registry backup maintenance skipped; recent backup exists ({reason}).");
        return maintenance_result(false, false, None, false, detail);
    }

    match create_backup_with_backups(config, host, AUTO_BACKUP_NAME.into(), now, &mut backups) {
        Ok(CreateBackupOutcome::Created) => {
            config.set_string(CONFIG_LAST_BACKUP_DATE, &iso_millis(now))?;
            let detail = format!("Registry auto backup created ({reason}).");
            maintenance_result(true, false, None, false, detail)
        }
        Ok(CreateBackupOutcome::NoRegistryData) => maintenance_result(
            false,
            false,
            None,
            false,
            "Registry auto backup skipped; no registry data was found.",
        ),
        Err(error) => Err(error),
    }
}

pub fn registry_backup_foreground_followup(
    config: &dyn ConfigStore,
    host: &dyn RegistryBackupHostActions,
) -> Result<RegistryBackupMaintenanceResult> {
    if host.has_registry_folder()? {
        return registry_backup_maintenance_run(
            config,
            host,
            RegistryBackupMaintenanceMode::Foreground,
            "foreground-followup",
        );
    }
    maybe_restore_prompt(config, RegistryBackupMaintenanceMode::Foreground)
}

fn read_backups(config: &dyn ConfigStore) -> Result<Vec<StoredRegistryBackup>> {
    let raw = config.get_json(CONFIG_BACKUPS, json!([]))?;
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

fn write_backups(config: &dyn ConfigStore, backups: &[StoredRegistryBackup]) -> Result<()> {
    let value = serde_json::to_value(backups)?;
    config.set_json(CONFIG_BACKUPS, &value)?;
    Ok(())
}

fn create_backup(
    config: &dyn ConfigStore,
    host: &dyn RegistryBackupHostActions,
    name: String,
    now: chrono::DateTime<Utc>,
) -> Result<CreateBackupOutcome> {
    let mut backups = read_backups(config)?;
    create_backup_with_backups(config, host, name, now, &mut backups)
}

fn create_backup_with_backups(
    config: &dyn ConfigStore,
    host: &dyn RegistryBackupHostActions,
    name: String,
    now: chrono::DateTime<Utc>,
    backups: &mut Vec<StoredRegistryBackup>,
) -> Result<CreateBackupOutcome> {
    let data = host.get_registry()?;
    if data.as_object().is_none_or(|object| object.is_empty()) {
        return Ok(CreateBackupOutcome::NoRegistryData);
    }

    backups.push(StoredRegistryBackup {
        name,
        date: iso_millis(now),
        data,
    });
    write_backups(config, backups)?;
    Ok(CreateBackupOutcome::Created)
}

fn prune_old_auto_backups(
    backups: &mut Vec<StoredRegistryBackup>,
    now: chrono::DateTime<Utc>,
) -> bool {
    let before = backups.len();
    let cutoff = now - AUTO_BACKUP_RETENTION;
    backups.retain(|backup| {
        if backup.name != AUTO_BACKUP_NAME {
            return true;
        }
        parse_backup_date(&backup.date).is_some_and(|date| date >= cutoff)
    });
    backups.len() != before
}

fn recent_auto_backup_exists(config: &dyn ConfigStore, now: chrono::DateTime<Utc>) -> Result<bool> {
    let last_backup_date = config.get_string(CONFIG_LAST_BACKUP_DATE, "")?;
    let Some(last_backup_date) = parse_backup_date(&last_backup_date) else {
        return Ok(false);
    };
    Ok(now - last_backup_date < AUTO_BACKUP_INTERVAL)
}

fn maybe_restore_prompt(
    config: &dyn ConfigStore,
    mode: RegistryBackupMaintenanceMode,
) -> Result<RegistryBackupMaintenanceResult> {
    if mode != RegistryBackupMaintenanceMode::Foreground {
        return maintenance_result(
            false,
            false,
            None,
            true,
            "Registry folder is missing; silent maintenance does not prompt.",
        );
    }
    if !config.get_bool(CONFIG_ASK_RESTORE, true)? {
        return maintenance_result(
            false,
            false,
            None,
            false,
            "Registry folder is missing; restore prompt is disabled.",
        );
    }
    let last_backup_date = config.get_string(CONFIG_LAST_BACKUP_DATE, "")?;
    let last_restore_check = config.get_string(CONFIG_LAST_RESTORE_CHECK, "")?;
    if last_backup_date.trim().is_empty() || last_restore_check == last_backup_date {
        return maintenance_result(
            false,
            false,
            None,
            false,
            "Registry folder is missing; no restore prompt is due.",
        );
    }
    maintenance_result(
        false,
        true,
        Some(last_backup_date),
        false,
        "Registry restore prompt is needed.",
    )
}

fn maintenance_result(
    auto_backup_created: bool,
    restore_prompt_needed: bool,
    restore_prompt_backup_date: Option<String>,
    restore_prompt_check_deferred: bool,
    detail: impl Into<String>,
) -> Result<RegistryBackupMaintenanceResult> {
    Ok(RegistryBackupMaintenanceResult {
        auto_backup_created,
        restore_prompt_needed,
        restore_prompt_backup_date,
        restore_prompt_check_deferred,
        detail: detail.into(),
    })
}

fn backup_key(backup: &StoredRegistryBackup, index: usize) -> String {
    let name = if backup.name.trim().is_empty() {
        "backup"
    } else {
        &backup.name
    };
    if backup.date.trim().is_empty() {
        format!("{index}-{name}")
    } else {
        format!("{}-{name}", backup.date)
    }
}

fn normalize_backup(backup: StoredRegistryBackup, index: usize) -> RegistryBackupSnapshot {
    let key = backup_key(&backup, index);
    let name = if backup.name.trim().is_empty() {
        "Backup".into()
    } else {
        backup.name
    };
    RegistryBackupSnapshot {
        key,
        name,
        date: backup.date,
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
    vrcx_0_core::vrchat_registry_policy::validate_registry_json(raw).map_err(|error| match error {
        vrcx_0_core::vrchat_registry_policy::RegistryPolicyError::Json(error) => Error::Json(error),
        vrcx_0_core::vrchat_registry_policy::RegistryPolicyError::Invalid(message) => {
            Error::RegistryPolicyInvalid(message)
        }
    })
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

fn parse_backup_date(value: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

#[cfg(test)]
mod tests;
