use super::*;
use crate::ports::TestGameStateStore;
use std::sync::atomic::{AtomicUsize, Ordering};

struct TestDir;

impl TestDir {
    fn new(name: &str) -> Self {
        let _ = name;
        Self
    }

    fn open_db(&self) -> TestGameStateStore {
        TestGameStateStore::default()
    }
}

struct StubHost {
    has_registry_folder: bool,
    registry: Value,
    get_registry_calls: AtomicUsize,
}

impl StubHost {
    fn with_registry(registry: Value) -> Self {
        Self {
            has_registry_folder: true,
            registry,
            get_registry_calls: AtomicUsize::new(0),
        }
    }

    fn without_registry_folder() -> Self {
        Self {
            has_registry_folder: false,
            registry: json!({}),
            get_registry_calls: AtomicUsize::new(0),
        }
    }
}

impl RegistryBackupHostActions for StubHost {
    fn has_registry_folder(&self) -> Result<bool> {
        Ok(self.has_registry_folder)
    }

    fn get_registry(&self) -> Result<Value> {
        self.get_registry_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.registry.clone())
    }

    fn set_registry_json(&self, _json: &str) -> Result<()> {
        Ok(())
    }
}

fn backup(name: &str, date: &str) -> StoredRegistryBackup {
    StoredRegistryBackup {
        name: name.into(),
        date: date.into(),
        data: json!({"key": "value"}),
    }
}

#[test]
fn export_preparation_preserves_name_normalization_and_json_shape() {
    for (name, expected_file_name) in [
        ("Named Backup", "Named Backup.json"),
        ("  Trimmed Backup  ", "Trimmed Backup.json"),
        ("", "VRChat Registry Backup.json"),
        ("   ", "VRChat Registry Backup.json"),
    ] {
        let dir = TestDir::new("export");
        let db = dir.open_db();
        write_backups(
            &db,
            &[StoredRegistryBackup {
                name: name.into(),
                date: "2026-08-22T00:00:00.000Z".into(),
                data: json!({"b": 2, "a": 1}),
            }],
        )
        .unwrap();
        let key = registry_backup_list(&db).unwrap()[0].key.clone();

        let export = registry_backup_prepare_export(&db, &key).unwrap();

        assert_eq!(export.file_name, expected_file_name);
        assert_eq!(
            serde_json::from_str::<Value>(&export.json).unwrap(),
            json!({"a": 1, "b": 2})
        );
    }
}

#[test]
fn export_preparation_preserves_the_missing_backup_error() {
    let dir = TestDir::new("export-missing");
    let db = dir.open_db();

    assert_eq!(
        registry_backup_prepare_export(&db, "missing")
            .unwrap_err()
            .to_string(),
        "Registry backup not found."
    );
}

#[test]
fn restore_accepts_lossless_binary_backup_and_records_completion() {
    let dir = TestDir::new("restore-binary");
    let db = dir.open_db();
    let backup_date = "2026-09-04T00:00:00.000Z";
    write_backups(
        &db,
        &[StoredRegistryBackup {
            name: "Binary Backup".into(),
            date: backup_date.into(),
            data: json!({
                "VRC_BINARY": {
                    "type": 3,
                    "data": [0, 65, 128, 228, 184, 173, 255, 0]
                }
            }),
        }],
    )
    .unwrap();
    let key = registry_backup_list(&db).unwrap()[0].key.clone();

    let restored = registry_backup_restore(
        &db,
        &StubHost::with_registry(json!({})),
        &key,
    )
    .unwrap();

    assert_eq!(restored.name, "Binary Backup");
    assert_eq!(
        db.get_string(CONFIG_LAST_RESTORE_CHECK, "").unwrap(),
        backup_date
    );
}

#[test]
fn restore_prompt_acknowledgement_persists_the_shown_backup_date() {
    let dir = TestDir::new("ack");
    let db = dir.open_db();
    let backup_date = "2026-08-01T12:34:56.000Z";

    assert_eq!(
        registry_backup_restore_prompt_acknowledge(&db, backup_date).unwrap(),
        backup_date
    );
    assert_eq!(
        db.get_string(CONFIG_LAST_RESTORE_CHECK, "").unwrap(),
        backup_date
    );
}

#[test]
fn maintenance_run_skips_everything_when_auto_backup_disabled() {
    let dir = TestDir::new("disabled");
    let db = dir.open_db();
    db.set_bool(CONFIG_AUTO_BACKUP, false).unwrap();
    let host = StubHost::with_registry(json!({"a": 1}));

    let result = registry_backup_maintenance_run(
        &db,
        &host,
        RegistryBackupMaintenanceMode::Foreground,
        "test",
    )
    .unwrap();

    assert!(!result.auto_backup_created);
    assert!(!result.restore_prompt_needed);
    assert_eq!(result.detail, "Registry auto backup is disabled.");
    assert_eq!(host.get_registry_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn maintenance_result_does_not_serialize_stored_backup_data() {
    let dir = TestDir::new("lightweight-result");
    let db = dir.open_db();
    db.set_bool(CONFIG_AUTO_BACKUP, false).unwrap();
    write_backups(
        &db,
        &[StoredRegistryBackup {
            name: "Large Backup".into(),
            date: "2026-08-01T00:00:00.000Z".into(),
            data: json!({"uniqueLargePayloadMarker": [1, 2, 3]}),
        }],
    )
    .unwrap();

    let result = registry_backup_maintenance_run(
        &db,
        &StubHost::with_registry(json!({"a": 1})),
        RegistryBackupMaintenanceMode::Foreground,
        "test",
    )
    .unwrap();
    let serialized = serde_json::to_value(result).unwrap();

    assert!(serialized.get("backups").is_none());
    assert!(!serialized.to_string().contains("uniqueLargePayloadMarker"));
    assert_eq!(registry_backup_list(&db).unwrap().len(), 1);
}

#[test]
fn maintenance_run_creates_auto_backup_when_registry_present_and_no_recent_backup() {
    let dir = TestDir::new("create");
    let db = dir.open_db();
    let host = StubHost::with_registry(json!({"a": 1}));

    let result = registry_backup_maintenance_run(
        &db,
        &host,
        RegistryBackupMaintenanceMode::Foreground,
        "startup",
    )
    .unwrap();

    assert!(result.auto_backup_created);
    assert!(!result.restore_prompt_needed);
    assert_eq!(result.detail, "Registry auto backup created (startup).");
    let backups = registry_backup_list(&db).unwrap();
    assert_eq!(backups.len(), 1);
    assert_eq!(backups[0].name, AUTO_BACKUP_NAME);
    assert!(!db
        .get_string(CONFIG_LAST_BACKUP_DATE, "")
        .unwrap()
        .is_empty());
}

#[test]
fn maintenance_run_skips_creation_when_recent_auto_backup_exists() {
    let dir = TestDir::new("recent");
    let db = dir.open_db();
    db.set_string(CONFIG_LAST_BACKUP_DATE, &iso_millis(Utc::now()))
        .unwrap();
    let host = StubHost::with_registry(json!({"a": 1}));

    let result = registry_backup_maintenance_run(
        &db,
        &host,
        RegistryBackupMaintenanceMode::Silent,
        "background-mode",
    )
    .unwrap();

    assert!(!result.auto_backup_created);
    assert!(!result.restore_prompt_needed);
    assert_eq!(
        result.detail,
        "Registry backup maintenance skipped; recent backup exists (background-mode)."
    );
    assert_eq!(host.get_registry_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn maintenance_run_prunes_expired_auto_backups_before_checking_recent_backup() {
    let dir = TestDir::new("prune");
    let db = dir.open_db();
    let now = Utc::now();
    let expired_date = iso_millis(now - AUTO_BACKUP_RETENTION - Duration::days(1));
    write_backups(&db, &[backup(AUTO_BACKUP_NAME, &expired_date)]).unwrap();
    let host = StubHost::with_registry(json!({"a": 1}));

    let result = registry_backup_maintenance_run(
        &db,
        &host,
        RegistryBackupMaintenanceMode::Foreground,
        "test",
    )
    .unwrap();

    assert!(result.auto_backup_created);
    let backups = registry_backup_list(&db).unwrap();
    assert_eq!(backups.len(), 1);
    assert_ne!(backups[0].date, expired_date);
}

#[test]
fn maintenance_run_falls_back_to_restore_prompt_when_registry_folder_missing() {
    let dir = TestDir::new("missing-folder");
    let db = dir.open_db();
    let last_backup_date = "2026-08-01T00:00:00.000Z";
    db.set_string(CONFIG_LAST_BACKUP_DATE, last_backup_date)
        .unwrap();
    let host = StubHost::without_registry_folder();

    let result = registry_backup_maintenance_run(
        &db,
        &host,
        RegistryBackupMaintenanceMode::Foreground,
        "test",
    )
    .unwrap();

    assert!(!result.auto_backup_created);
    assert!(result.restore_prompt_needed);
    assert_eq!(
        result.restore_prompt_backup_date,
        Some(last_backup_date.to_string())
    );
    assert_eq!(host.get_registry_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn maintenance_run_reports_skip_when_registry_data_is_empty() {
    let dir = TestDir::new("empty-data");
    let db = dir.open_db();
    let host = StubHost::with_registry(json!({}));

    let result = registry_backup_maintenance_run(
        &db,
        &host,
        RegistryBackupMaintenanceMode::Foreground,
        "test",
    )
    .unwrap();

    assert!(!result.auto_backup_created);
    assert!(!result.restore_prompt_needed);
    assert_eq!(
        result.detail,
        "Registry auto backup skipped; no registry data was found."
    );
    assert!(db
        .get_string(CONFIG_LAST_BACKUP_DATE, "")
        .unwrap()
        .is_empty());
}

#[test]
fn manual_backup_preserves_the_no_registry_data_error_contract() {
    let dir = TestDir::new("manual-empty-data");
    let db = dir.open_db();
    let host = StubHost::with_registry(json!({}));

    assert!(matches!(
        registry_backup_create(&db, &host, "Manual Backup"),
        Err(Error::Custom(message)) if message == NO_REGISTRY_DATA_MESSAGE
    ));
}

#[test]
fn prune_old_auto_backups_removes_only_expired_auto_backups() {
    let now = Utc::now();
    let fresh_date = iso_millis(now - Duration::days(1));
    let expired_date = iso_millis(now - AUTO_BACKUP_RETENTION - Duration::days(1));
    let mut backups = vec![
        backup(AUTO_BACKUP_NAME, &fresh_date),
        backup(AUTO_BACKUP_NAME, &expired_date),
    ];

    let pruned = prune_old_auto_backups(&mut backups, now);

    assert!(pruned);
    assert_eq!(backups.len(), 1);
    assert_eq!(backups[0].date, fresh_date);
}

#[test]
fn prune_old_auto_backups_keeps_manual_backups_regardless_of_age() {
    let now = Utc::now();
    let expired_date = iso_millis(now - AUTO_BACKUP_RETENTION - Duration::days(1));
    let mut backups = vec![backup(MANUAL_BACKUP_NAME, &expired_date)];

    let pruned = prune_old_auto_backups(&mut backups, now);

    assert!(!pruned);
    assert_eq!(backups.len(), 1);
}

#[test]
fn prune_old_auto_backups_removes_auto_backups_with_unparsable_dates() {
    let now = Utc::now();
    let mut backups = vec![backup(AUTO_BACKUP_NAME, "not-a-date")];

    let pruned = prune_old_auto_backups(&mut backups, now);

    assert!(pruned);
    assert!(backups.is_empty());
}

#[test]
fn recent_auto_backup_exists_is_false_when_no_backup_date_recorded() {
    let dir = TestDir::new("recent-none");
    let db = dir.open_db();

    assert!(!recent_auto_backup_exists(&db, Utc::now()).unwrap());
}

#[test]
fn recent_auto_backup_exists_is_true_within_interval() {
    let dir = TestDir::new("recent-within");
    let db = dir.open_db();
    let now = Utc::now();
    db.set_string(
        CONFIG_LAST_BACKUP_DATE,
        &iso_millis(now - Duration::days(1)),
    )
    .unwrap();

    assert!(recent_auto_backup_exists(&db, now).unwrap());
}

#[test]
fn recent_auto_backup_exists_is_false_outside_interval() {
    let dir = TestDir::new("recent-outside");
    let db = dir.open_db();
    let now = Utc::now();
    db.set_string(
        CONFIG_LAST_BACKUP_DATE,
        &iso_millis(now - AUTO_BACKUP_INTERVAL - Duration::days(1)),
    )
    .unwrap();

    assert!(!recent_auto_backup_exists(&db, now).unwrap());
}

#[test]
fn maybe_restore_prompt_is_silent_in_background_mode() {
    let dir = TestDir::new("prompt-silent");
    let db = dir.open_db();
    db.set_string(CONFIG_LAST_BACKUP_DATE, "2026-08-01T00:00:00.000Z")
        .unwrap();

    let result = maybe_restore_prompt(&db, RegistryBackupMaintenanceMode::Silent).unwrap();

    assert!(!result.restore_prompt_needed);
    assert!(result.restore_prompt_check_deferred);
    assert_eq!(
        result.detail,
        "Registry folder is missing; silent maintenance does not prompt."
    );
}

#[test]
fn maybe_restore_prompt_is_disabled_by_config() {
    let dir = TestDir::new("prompt-disabled");
    let db = dir.open_db();
    db.set_bool(CONFIG_ASK_RESTORE, false).unwrap();
    db.set_string(CONFIG_LAST_BACKUP_DATE, "2026-08-01T00:00:00.000Z")
        .unwrap();

    let result = maybe_restore_prompt(&db, RegistryBackupMaintenanceMode::Foreground).unwrap();

    assert!(!result.restore_prompt_needed);
    assert_eq!(
        result.detail,
        "Registry folder is missing; restore prompt is disabled."
    );
}

#[test]
fn maybe_restore_prompt_skips_when_no_backup_date_recorded() {
    let dir = TestDir::new("prompt-no-date");
    let db = dir.open_db();

    let result = maybe_restore_prompt(&db, RegistryBackupMaintenanceMode::Foreground).unwrap();

    assert!(!result.restore_prompt_needed);
    assert_eq!(
        result.detail,
        "Registry folder is missing; no restore prompt is due."
    );
}

#[test]
fn maybe_restore_prompt_skips_when_already_acknowledged() {
    let dir = TestDir::new("prompt-acked");
    let db = dir.open_db();
    let backup_date = "2026-08-01T00:00:00.000Z";
    db.set_string(CONFIG_LAST_BACKUP_DATE, backup_date).unwrap();
    db.set_string(CONFIG_LAST_RESTORE_CHECK, backup_date)
        .unwrap();

    let result = maybe_restore_prompt(&db, RegistryBackupMaintenanceMode::Foreground).unwrap();

    assert!(!result.restore_prompt_needed);
    assert_eq!(
        result.detail,
        "Registry folder is missing; no restore prompt is due."
    );
}

#[test]
fn maybe_restore_prompt_fires_when_new_backup_is_unacknowledged() {
    let dir = TestDir::new("prompt-due");
    let db = dir.open_db();
    let backup_date = "2026-08-01T00:00:00.000Z";
    db.set_string(CONFIG_LAST_BACKUP_DATE, backup_date).unwrap();
    db.set_string(CONFIG_LAST_RESTORE_CHECK, "2026-07-01T00:00:00.000Z")
        .unwrap();

    let result = maybe_restore_prompt(&db, RegistryBackupMaintenanceMode::Foreground).unwrap();

    assert!(result.restore_prompt_needed);
    assert_eq!(
        result.restore_prompt_backup_date,
        Some(backup_date.to_string())
    );
    assert_eq!(result.detail, "Registry restore prompt is needed.");
}

#[test]
fn normalize_backup_falls_back_to_index_and_default_name_for_empty_fields() {
    let cases = [
        (
            "Auto Backup",
            "2026-01-01T00:00:00.000Z",
            5,
            "2026-01-01T00:00:00.000Z-Auto Backup",
            "Auto Backup",
        ),
        (
            "",
            "2026-01-01T00:00:00.000Z",
            2,
            "2026-01-01T00:00:00.000Z-backup",
            "Backup",
        ),
        ("Manual Backup", "", 3, "3-Manual Backup", "Manual Backup"),
        ("", "", 7, "7-backup", "Backup"),
    ];

    for (name, date, index, expected_key, expected_name) in cases {
        let snapshot = normalize_backup(backup(name, date), index);

        assert_eq!(snapshot.key, expected_key);
        assert_eq!(snapshot.name, expected_name);
        assert_eq!(snapshot.date, date);
    }
}
