use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tempfile::{Builder as TempBuilder, NamedTempFile};
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::{
    current_vrcx0_schema_version, database_sidecar_paths, remove_database_sidecars,
    validate_database_file, DatabaseService,
};

use crate::profile_backup::{
    extract_validated_profile_backup, PROFILE_CONFIG_FILE, PROFILE_DATABASE_FILE,
};
use crate::{Error, ProfileBackupManifest, Result};

const RESTORE_ROOT_DIRECTORY: &str = "profile-restore";
const ACTIVE_TRANSACTION_DIRECTORY: &str = "active";
const RESULT_DIRECTORY: &str = "result";
const STAGED_DIRECTORY: &str = "staged";
const ROLLBACK_DIRECTORY: &str = "rollback";
const REDO_DIRECTORY: &str = "redo";
const DATABASE_UPGRADE_DIRECTORY: &str = "db-upgrade";
const RESULT_STATE_FILE: &str = "state.json";
const JOURNAL_PREFIX: &str = "journal-";
const JOURNAL_SUFFIX: &str = ".json";
const TRANSACTION_FORMAT_VERSION: u32 = 1;

#[cfg(test)]
const FAIL_RESTORE_AFTER_DATABASE_INSTALL: &str = "restoreAfterDatabaseInstall";
#[cfg(test)]
const FAIL_ROLLBACK_BEFORE_INSTALL: &str = "rollbackBeforeInstall";
#[cfg(test)]
const FAIL_ROLLBACK_BEFORE_REDO_RESTORE: &str = "rollbackBeforeRedoRestore";

macro_rules! restore_test_checkpoint {
    ($point:expr) => {
        #[cfg(test)]
        inject_restore_test_failure($point)?;
    };
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreStatus {
    Idle,
    PendingRestore,
    RestoredAwaitingConfirmation,
    PendingRollback,
    RestoreFailedRolledBack,
    RollbackCompleted,
    Blocked,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreState {
    pub status: ProfileRestoreStatus,
    pub updated_at: Option<String>,
    pub backup_created_at: Option<String>,
    pub backup_app_version: Option<String>,
    pub backup_database_schema_version: Option<i64>,
    pub message: Option<String>,
    pub requires_restart: bool,
    pub can_confirm: bool,
    pub can_rollback: bool,
    pub can_acknowledge: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreRequestResult {
    pub state: ProfileRestoreState,
    pub restart_requested: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileRestoreStartupOutcome {
    None,
    Restored,
    RestoreFailedRolledBack,
    RollbackCompleted,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum RestoreTransactionPhase {
    Prepared,
    CapturingCurrent,
    InstallingRestore,
    RevertingFailedRestore,
    AwaitingConfirmation,
    RollbackPrepared,
    CapturingRedo,
    InstallingRollback,
    RollbackFailedCaptureOriginal,
    RollbackFailedRestoreCurrent,
    Blocked,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredProfileFiles {
    database: bool,
    config: bool,
    wal: bool,
    shm: bool,
    database_upgrade: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreJournal {
    format_version: u32,
    sequence: u64,
    phase: RestoreTransactionPhase,
    updated_at: String,
    manifest: ProfileBackupManifest,
    message: Option<String>,
    rollback: StoredProfileFiles,
    redo: StoredProfileFiles,
}

#[derive(Clone)]
struct RestorePaths {
    app_data: PathBuf,
    root: PathBuf,
    active: PathBuf,
    result: PathBuf,
}

#[derive(Clone, Copy)]
enum ProfileFileSlot {
    Database,
    Config,
    Wal,
    Shm,
    DatabaseUpgrade,
}

const PROFILE_FILE_SLOTS: [ProfileFileSlot; 5] = [
    ProfileFileSlot::Database,
    ProfileFileSlot::Config,
    ProfileFileSlot::Wal,
    ProfileFileSlot::Shm,
    ProfileFileSlot::DatabaseUpgrade,
];

impl ProfileRestoreState {
    pub fn idle() -> Self {
        Self {
            status: ProfileRestoreStatus::Idle,
            updated_at: None,
            backup_created_at: None,
            backup_app_version: None,
            backup_database_schema_version: None,
            message: None,
            requires_restart: false,
            can_confirm: false,
            can_rollback: false,
            can_acknowledge: false,
        }
    }
}

impl RestorePaths {
    fn new(app_data: &Path) -> Self {
        let root = app_data.join(RESTORE_ROOT_DIRECTORY);
        Self {
            app_data: app_data.to_path_buf(),
            active: root.join(ACTIVE_TRANSACTION_DIRECTORY),
            result: root.join(RESULT_DIRECTORY),
            root,
        }
    }

    fn staged(&self) -> PathBuf {
        self.active.join(STAGED_DIRECTORY)
    }

    fn rollback(&self) -> PathBuf {
        self.active.join(ROLLBACK_DIRECTORY)
    }

    fn redo(&self) -> PathBuf {
        self.active.join(REDO_DIRECTORY)
    }
}

impl StoredProfileFiles {
    fn get(&self, slot: ProfileFileSlot) -> bool {
        match slot {
            ProfileFileSlot::Database => self.database,
            ProfileFileSlot::Config => self.config,
            ProfileFileSlot::Wal => self.wal,
            ProfileFileSlot::Shm => self.shm,
            ProfileFileSlot::DatabaseUpgrade => self.database_upgrade,
        }
    }

    fn set(&mut self, slot: ProfileFileSlot, value: bool) {
        match slot {
            ProfileFileSlot::Database => self.database = value,
            ProfileFileSlot::Config => self.config = value,
            ProfileFileSlot::Wal => self.wal = value,
            ProfileFileSlot::Shm => self.shm = value,
            ProfileFileSlot::DatabaseUpgrade => self.database_upgrade = value,
        }
    }
}

pub fn profile_restore_state(app_data: &Path) -> Result<ProfileRestoreState> {
    let paths = RestorePaths::new(app_data);
    if paths.result.is_dir() {
        return read_json_file(&paths.result.join(RESULT_STATE_FILE));
    }
    if !paths.active.is_dir() {
        return Ok(ProfileRestoreState::idle());
    }
    let journal = read_latest_journal(&paths.active)?;
    Ok(state_from_journal(&journal, &paths))
}

pub fn prepare_profile_restore(
    archive_path: &Path,
    app_data: &Path,
) -> Result<ProfileRestoreState> {
    let paths = RestorePaths::new(app_data);
    if profile_restore_state(app_data)?.status != ProfileRestoreStatus::Idle {
        return Err(Error::Custom(
            "A profile restore or unacknowledged restore result already exists.".into(),
        ));
    }
    fs::create_dir_all(&paths.root)?;
    cleanup_orphan_prepare_directories(&paths.root);

    let transaction = TempBuilder::new()
        .prefix(".prepare-")
        .tempdir_in(&paths.root)?;
    let staged = transaction.path().join(STAGED_DIRECTORY);
    fs::create_dir_all(&staged)?;
    fs::create_dir_all(transaction.path().join(ROLLBACK_DIRECTORY))?;
    fs::create_dir_all(transaction.path().join(REDO_DIRECTORY))?;

    let database_path = staged.join(PROFILE_DATABASE_FILE);
    let config_path = staged.join(PROFILE_CONFIG_FILE);
    let manifest = extract_validated_profile_backup(archive_path, &database_path, &config_path)?;
    validate_profile_files(&database_path, &config_path, Some(&manifest), true)?;

    let mut journal = RestoreJournal {
        format_version: TRANSACTION_FORMAT_VERSION,
        sequence: 0,
        phase: RestoreTransactionPhase::Prepared,
        updated_at: now_iso(),
        manifest,
        message: None,
        rollback: StoredProfileFiles::default(),
        redo: StoredProfileFiles::default(),
    };
    write_journal(transaction.path(), &mut journal)?;

    let transaction_path = transaction.keep();
    if let Err(error) = fs::rename(&transaction_path, &paths.active) {
        let _ = fs::remove_dir_all(&transaction_path);
        return Err(Error::Io(error));
    }
    Ok(state_from_journal(&journal, &paths))
}

pub fn consume_pending_profile_restore(app_data: &Path) -> Result<ProfileRestoreStartupOutcome> {
    let paths = RestorePaths::new(app_data);
    if paths.root.is_dir() {
        cleanup_orphan_prepare_directories(&paths.root);
    }
    if paths.result.is_dir() {
        if paths.active.is_dir() {
            if let Err(error) = fs::remove_dir_all(&paths.active) {
                tracing::warn!(
                    path = %paths.active.display(),
                    "failed to clean completed profile restore transaction: {error}"
                );
            }
        }
        return Ok(ProfileRestoreStartupOutcome::None);
    }
    if !paths.active.is_dir() {
        return Ok(ProfileRestoreStartupOutcome::None);
    }

    let journal = read_latest_journal(&paths.active)?;
    match journal.phase {
        RestoreTransactionPhase::Prepared
        | RestoreTransactionPhase::CapturingCurrent
        | RestoreTransactionPhase::InstallingRestore => install_restore(&paths, journal),
        RestoreTransactionPhase::RevertingFailedRestore => revert_failed_restore(&paths, journal),
        RestoreTransactionPhase::AwaitingConfirmation => Ok(ProfileRestoreStartupOutcome::None),
        RestoreTransactionPhase::RollbackPrepared
        | RestoreTransactionPhase::CapturingRedo
        | RestoreTransactionPhase::InstallingRollback
        | RestoreTransactionPhase::RollbackFailedCaptureOriginal
        | RestoreTransactionPhase::RollbackFailedRestoreCurrent => {
            install_rollback(&paths, journal)
        }
        RestoreTransactionPhase::Blocked => Err(Error::Custom(
            state_from_journal(&journal, &paths)
                .message
                .unwrap_or_else(|| "Profile restore is blocked.".into()),
        )),
    }
}

pub fn confirm_profile_restore(app_data: &Path) -> Result<ProfileRestoreState> {
    let paths = RestorePaths::new(app_data);
    let journal = read_latest_journal(&paths.active)?;
    if journal.phase != RestoreTransactionPhase::AwaitingConfirmation {
        return Err(Error::Custom(
            "The restored profile is not awaiting confirmation.".into(),
        ));
    }
    fs::remove_dir_all(&paths.active)?;
    remove_restore_root_if_empty(&paths.root);
    Ok(ProfileRestoreState::idle())
}

pub fn request_profile_rollback(app_data: &Path) -> Result<ProfileRestoreState> {
    let paths = RestorePaths::new(app_data);
    let mut journal = read_latest_journal(&paths.active)?;
    if journal.phase != RestoreTransactionPhase::AwaitingConfirmation {
        return Err(Error::Custom(
            "The restored profile is not available for rollback.".into(),
        ));
    }
    journal.phase = RestoreTransactionPhase::RollbackPrepared;
    journal.message = None;
    write_journal(&paths.active, &mut journal)?;
    Ok(state_from_journal(&journal, &paths))
}

pub fn acknowledge_profile_restore_result(app_data: &Path) -> Result<ProfileRestoreState> {
    let paths = RestorePaths::new(app_data);
    let state = profile_restore_state(app_data)?;
    if !state.can_acknowledge {
        return Err(Error::Custom(
            "There is no completed profile restore result to acknowledge.".into(),
        ));
    }
    if paths.active.exists() {
        fs::remove_dir_all(&paths.active)?;
    }
    fs::remove_dir_all(&paths.result)?;
    remove_restore_root_if_empty(&paths.root);
    Ok(ProfileRestoreState::idle())
}

pub fn profile_restore_blocks_legacy_migration(app_data: &Path) -> bool {
    RestorePaths::new(app_data).active.is_dir()
}

pub fn automatic_profile_backups_allowed(app_data: &Path) -> bool {
    matches!(
        profile_restore_state(app_data).map(|state| state.status),
        Ok(ProfileRestoreStatus::Idle)
            | Ok(ProfileRestoreStatus::RestoreFailedRolledBack)
            | Ok(ProfileRestoreStatus::RollbackCompleted)
    )
}

fn install_restore(
    paths: &RestorePaths,
    mut journal: RestoreJournal,
) -> Result<ProfileRestoreStartupOutcome> {
    if journal.phase == RestoreTransactionPhase::Prepared {
        let staged = paths.staged();
        if let Err(error) = validate_profile_files(
            &staged.join(PROFILE_DATABASE_FILE),
            &staged.join(PROFILE_CONFIG_FILE),
            Some(&journal.manifest),
            true,
        ) {
            validate_runtime_profile(&paths.app_data)?;
            return finish_with_result(
                paths,
                &journal,
                ProfileRestoreStatus::RestoreFailedRolledBack,
                format!("Profile restore validation failed before replacement: {error}"),
                ProfileRestoreStartupOutcome::RestoreFailedRolledBack,
            );
        }
        journal.phase = RestoreTransactionPhase::CapturingCurrent;
        write_journal(&paths.active, &mut journal)?;
    }

    let result: Result<()> = (|| {
        if journal.phase == RestoreTransactionPhase::CapturingCurrent {
            capture_profile_set(
                &paths.app_data,
                &paths.rollback(),
                &paths.active,
                &mut journal,
                false,
            )?;
            journal.phase = RestoreTransactionPhase::InstallingRestore;
            write_journal(&paths.active, &mut journal)?;
        }

        install_staged_profile(paths)?;
        validate_profile_files(
            &profile_path(&paths.app_data, ProfileFileSlot::Database),
            &profile_path(&paths.app_data, ProfileFileSlot::Config),
            Some(&journal.manifest),
            true,
        )?;
        validate_runtime_profile(&paths.app_data)?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            journal.phase = RestoreTransactionPhase::AwaitingConfirmation;
            journal.message = None;
            write_journal(&paths.active, &mut journal)?;
            Ok(ProfileRestoreStartupOutcome::Restored)
        }
        Err(error) => {
            journal.phase = RestoreTransactionPhase::RevertingFailedRestore;
            journal.message = Some(error.to_string());
            write_journal(&paths.active, &mut journal)?;
            revert_failed_restore(paths, journal)
        }
    }
}

fn revert_failed_restore(
    paths: &RestorePaths,
    mut journal: RestoreJournal,
) -> Result<ProfileRestoreStartupOutcome> {
    let restore_error = journal
        .message
        .clone()
        .unwrap_or_else(|| "Profile restore failed.".into());
    let rollback_result: Result<()> = (|| {
        replace_live_from_set(&paths.rollback(), &paths.app_data, &journal.rollback)?;
        validate_runtime_profile(&paths.app_data)
    })();
    match rollback_result {
        Ok(()) => finish_with_result(
            paths,
            &journal,
            ProfileRestoreStatus::RestoreFailedRolledBack,
            format!("{restore_error} The original profile was restored automatically."),
            ProfileRestoreStartupOutcome::RestoreFailedRolledBack,
        ),
        Err(rollback_error) => {
            journal.phase = RestoreTransactionPhase::Blocked;
            journal.message = Some(format!(
                "{restore_error} Automatic rollback also failed: {rollback_error}"
            ));
            write_journal(&paths.active, &mut journal)?;
            Err(Error::Custom(blocked_message(&journal, paths)))
        }
    }
}

fn install_rollback(
    paths: &RestorePaths,
    mut journal: RestoreJournal,
) -> Result<ProfileRestoreStartupOutcome> {
    if matches!(
        journal.phase,
        RestoreTransactionPhase::RollbackPrepared
            | RestoreTransactionPhase::CapturingRedo
            | RestoreTransactionPhase::InstallingRollback
    ) {
        let rollback_validation = validate_profile_files(
            &profile_path(&paths.rollback(), ProfileFileSlot::Database),
            &profile_path(&paths.rollback(), ProfileFileSlot::Config),
            None,
            journal.rollback.config,
        );
        if let Err(error) = rollback_validation {
            journal.phase = RestoreTransactionPhase::AwaitingConfirmation;
            journal.message = Some(format!("Rollback validation failed: {error}"));
            write_journal(&paths.active, &mut journal)?;
            return Ok(ProfileRestoreStartupOutcome::None);
        }
        if refresh_stored_profile_files(&paths.rollback(), &mut journal.rollback) {
            write_journal(&paths.active, &mut journal)?;
        }

        let rollback_result: Result<()> = (|| {
            if journal.phase == RestoreTransactionPhase::RollbackPrepared {
                journal.phase = RestoreTransactionPhase::CapturingRedo;
                write_journal(&paths.active, &mut journal)?;
            }
            if journal.phase == RestoreTransactionPhase::CapturingRedo {
                capture_profile_set(
                    &paths.app_data,
                    &paths.redo(),
                    &paths.active,
                    &mut journal,
                    true,
                )?;
                journal.phase = RestoreTransactionPhase::InstallingRollback;
                write_journal(&paths.active, &mut journal)?;
            }
            restore_test_checkpoint!(FAIL_ROLLBACK_BEFORE_INSTALL);
            replace_live_from_set(&paths.rollback(), &paths.app_data, &journal.rollback)?;
            validate_runtime_profile(&paths.app_data)
        })();

        match rollback_result {
            Ok(()) => {
                return finish_with_result(
                    paths,
                    &journal,
                    ProfileRestoreStatus::RollbackCompleted,
                    "The original profile was restored.".into(),
                    ProfileRestoreStartupOutcome::RollbackCompleted,
                );
            }
            Err(error) => {
                journal.phase = RestoreTransactionPhase::RollbackFailedCaptureOriginal;
                journal.message = Some(error.to_string());
                write_journal(&paths.active, &mut journal)?;
            }
        }
    }

    let rollback_error = journal
        .message
        .clone()
        .unwrap_or_else(|| "Rollback failed.".into());
    let restore_current_result: Result<()> = (|| {
        if journal.phase == RestoreTransactionPhase::RollbackFailedCaptureOriginal {
            capture_profile_set(
                &paths.app_data,
                &paths.rollback(),
                &paths.active,
                &mut journal,
                false,
            )?;
            journal.phase = RestoreTransactionPhase::RollbackFailedRestoreCurrent;
            write_journal(&paths.active, &mut journal)?;
        }
        restore_test_checkpoint!(FAIL_ROLLBACK_BEFORE_REDO_RESTORE);
        replace_live_from_set(&paths.redo(), &paths.app_data, &journal.redo)?;
        validate_runtime_profile(&paths.app_data)
    })();
    match restore_current_result {
        Ok(()) => {
            journal.phase = RestoreTransactionPhase::AwaitingConfirmation;
            journal.message = Some(format!(
                "Rollback failed, so the restored profile was put back: {rollback_error}"
            ));
            write_journal(&paths.active, &mut journal)?;
            Ok(ProfileRestoreStartupOutcome::None)
        }
        Err(restore_error) => {
            journal.phase = RestoreTransactionPhase::Blocked;
            journal.message = Some(format!(
                "Rollback failed: {rollback_error}. Restoring the replacement profile also failed: {restore_error}"
            ));
            write_journal(&paths.active, &mut journal)?;
            Err(Error::Custom(blocked_message(&journal, paths)))
        }
    }
}

fn install_staged_profile(paths: &RestorePaths) -> Result<()> {
    let staged = paths.staged();
    let source_database = staged.join(PROFILE_DATABASE_FILE);
    let source_config = staged.join(PROFILE_CONFIG_FILE);
    let live_database = profile_path(&paths.app_data, ProfileFileSlot::Database);
    let live_config = profile_path(&paths.app_data, ProfileFileSlot::Config);
    ensure_moved(&source_database, &live_database, true)?;
    restore_test_checkpoint!(FAIL_RESTORE_AFTER_DATABASE_INSTALL);
    ensure_moved(&source_config, &live_config, true)?;
    remove_database_sidecars(&live_database)?;
    Ok(())
}

fn validate_profile_files(
    database_path: &Path,
    config_path: &Path,
    manifest: Option<&ProfileBackupManifest>,
    require_config: bool,
) -> Result<i64> {
    if require_config || config_path.exists() {
        let config = File::open(config_path)?;
        serde_json::from_reader::<_, BTreeMap<String, String>>(BufReader::new(config))?;
    }
    let schema_version = validate_database_file(database_path)?;
    let current_schema_version = current_vrcx0_schema_version();
    if schema_version <= 0 || schema_version > current_schema_version {
        return Err(Error::Custom(format!(
            "Unsupported profile database schema version {schema_version}; current version is {current_schema_version}."
        )));
    }
    if let Some(manifest) = manifest {
        if schema_version != manifest.database_schema_version {
            return Err(Error::Custom(format!(
                "Profile database schema version {schema_version} does not match manifest version {}.",
                manifest.database_schema_version
            )));
        }
    }
    Ok(schema_version)
}

fn validate_runtime_profile(app_data: &Path) -> Result<()> {
    let database_path = profile_path(app_data, ProfileFileSlot::Database);
    let config_path = profile_path(app_data, ProfileFileSlot::Config);
    if database_path.exists() {
        validate_profile_files(&database_path, &config_path, None, false)?;
    }
    let storage = StorageService::new(&config_path)?;
    let _ = storage.get_all();
    drop(storage);
    let database = DatabaseService::new(&database_path)?;
    let _ = database.vrcx0_schema_version()?;
    drop(database);
    Ok(())
}

fn capture_profile_set(
    live_base: &Path,
    stored_base: &Path,
    active: &Path,
    journal: &mut RestoreJournal,
    redo: bool,
) -> Result<()> {
    fs::create_dir_all(stored_base)?;
    for slot in PROFILE_FILE_SLOTS {
        let expected = if redo {
            journal.redo.get(slot)
        } else {
            journal.rollback.get(slot)
        };
        let moved = ensure_moved(
            &profile_path(live_base, slot),
            &profile_path(stored_base, slot),
            expected,
        )?;
        let changed = if redo {
            let changed = journal.redo.get(slot) != moved;
            journal.redo.set(slot, moved);
            changed
        } else {
            let changed = journal.rollback.get(slot) != moved;
            journal.rollback.set(slot, moved);
            changed
        };
        if changed {
            write_journal(active, journal)?;
        }
    }
    Ok(())
}

fn refresh_stored_profile_files(base: &Path, files: &mut StoredProfileFiles) -> bool {
    let mut changed = false;
    for slot in PROFILE_FILE_SLOTS {
        if profile_path(base, slot).exists() && !files.get(slot) {
            files.set(slot, true);
            changed = true;
        }
    }
    changed
}

fn replace_live_from_set(
    stored_base: &Path,
    live_base: &Path,
    files: &StoredProfileFiles,
) -> Result<()> {
    for slot in PROFILE_FILE_SLOTS {
        let source = profile_path(stored_base, slot);
        let destination = profile_path(live_base, slot);
        if files.get(slot) {
            if source.exists() {
                remove_path_if_exists(&destination)?;
                fs::rename(&source, &destination)?;
            } else if !destination.exists() {
                return Err(Error::Custom(format!(
                    "Restore transaction lost required file: {}",
                    source.display()
                )));
            }
        } else {
            if source.exists() {
                return Err(Error::Custom(format!(
                    "Restore transaction contains an unexpected file: {}",
                    source.display()
                )));
            }
            remove_path_if_exists(&destination)?;
        }
    }
    Ok(())
}

fn ensure_moved(source: &Path, destination: &Path, expected: bool) -> Result<bool> {
    match (source.exists(), destination.exists()) {
        (true, false) => {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(source, destination)?;
            Ok(true)
        }
        (false, true) => Ok(true),
        (false, false) if expected => Err(Error::Custom(format!(
            "Restore transaction lost required file: {}",
            source.display()
        ))),
        (false, false) => Ok(false),
        (true, true) => Err(Error::Custom(format!(
            "Restore transaction found both source and destination: '{}' and '{}'.",
            source.display(),
            destination.display()
        ))),
    }
}

fn profile_path(base: &Path, slot: ProfileFileSlot) -> PathBuf {
    let database = base.join(PROFILE_DATABASE_FILE);
    match slot {
        ProfileFileSlot::Database => database,
        ProfileFileSlot::Config => base.join(PROFILE_CONFIG_FILE),
        ProfileFileSlot::Wal => database_sidecar_paths(&database)[0].clone(),
        ProfileFileSlot::Shm => database_sidecar_paths(&database)[1].clone(),
        ProfileFileSlot::DatabaseUpgrade => base.join(DATABASE_UPGRADE_DIRECTORY),
    }
}

fn state_from_journal(journal: &RestoreJournal, paths: &RestorePaths) -> ProfileRestoreState {
    let status = match journal.phase {
        RestoreTransactionPhase::Prepared
        | RestoreTransactionPhase::CapturingCurrent
        | RestoreTransactionPhase::InstallingRestore
        | RestoreTransactionPhase::RevertingFailedRestore => ProfileRestoreStatus::PendingRestore,
        RestoreTransactionPhase::AwaitingConfirmation => {
            ProfileRestoreStatus::RestoredAwaitingConfirmation
        }
        RestoreTransactionPhase::RollbackPrepared
        | RestoreTransactionPhase::CapturingRedo
        | RestoreTransactionPhase::InstallingRollback
        | RestoreTransactionPhase::RollbackFailedCaptureOriginal
        | RestoreTransactionPhase::RollbackFailedRestoreCurrent => {
            ProfileRestoreStatus::PendingRollback
        }
        RestoreTransactionPhase::Blocked => ProfileRestoreStatus::Blocked,
    };
    let message = if status == ProfileRestoreStatus::Blocked {
        Some(blocked_message(journal, paths))
    } else {
        journal.message.clone()
    };
    ProfileRestoreState {
        status,
        updated_at: Some(journal.updated_at.clone()),
        backup_created_at: Some(journal.manifest.created_at.clone()),
        backup_app_version: Some(journal.manifest.app_version.clone()),
        backup_database_schema_version: Some(journal.manifest.database_schema_version),
        message,
        requires_restart: matches!(
            status,
            ProfileRestoreStatus::PendingRestore | ProfileRestoreStatus::PendingRollback
        ),
        can_confirm: status == ProfileRestoreStatus::RestoredAwaitingConfirmation,
        can_rollback: status == ProfileRestoreStatus::RestoredAwaitingConfirmation,
        can_acknowledge: false,
    }
}

fn result_state(
    journal: &RestoreJournal,
    status: ProfileRestoreStatus,
    message: String,
) -> ProfileRestoreState {
    ProfileRestoreState {
        status,
        updated_at: Some(now_iso()),
        backup_created_at: Some(journal.manifest.created_at.clone()),
        backup_app_version: Some(journal.manifest.app_version.clone()),
        backup_database_schema_version: Some(journal.manifest.database_schema_version),
        message: Some(message),
        requires_restart: false,
        can_confirm: false,
        can_rollback: false,
        can_acknowledge: true,
    }
}

fn finish_with_result(
    paths: &RestorePaths,
    journal: &RestoreJournal,
    status: ProfileRestoreStatus,
    message: String,
    outcome: ProfileRestoreStartupOutcome,
) -> Result<ProfileRestoreStartupOutcome> {
    publish_result(paths, &result_state(journal, status, message))?;
    if paths.active.exists() {
        fs::remove_dir_all(&paths.active)?;
    }
    Ok(outcome)
}

fn publish_result(paths: &RestorePaths, state: &ProfileRestoreState) -> Result<()> {
    if paths.result.exists() {
        return Ok(());
    }
    fs::create_dir_all(&paths.root)?;
    let result = TempBuilder::new()
        .prefix(".result-")
        .tempdir_in(&paths.root)?;
    write_json_file(&result.path().join(RESULT_STATE_FILE), state)?;
    let result_path = result.keep();
    if let Err(error) = fs::rename(&result_path, &paths.result) {
        let _ = fs::remove_dir_all(&result_path);
        return Err(Error::Io(error));
    }
    Ok(())
}

fn read_latest_journal(active: &Path) -> Result<RestoreJournal> {
    if !active.is_dir() {
        return Err(Error::Custom(
            "Profile restore transaction is missing.".into(),
        ));
    }
    let journal_path = fs::read_dir(active)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.starts_with(JOURNAL_PREFIX) && name.ends_with(JOURNAL_SUFFIX)
                })
        })
        .max()
        .ok_or_else(|| Error::Custom("Profile restore journal is missing.".into()))?;
    let journal: RestoreJournal = read_json_file(&journal_path)?;
    if journal.format_version != TRANSACTION_FORMAT_VERSION {
        return Err(Error::Custom(format!(
            "Unsupported profile restore transaction version: {}",
            journal.format_version
        )));
    }
    Ok(journal)
}

fn write_journal(active: &Path, journal: &mut RestoreJournal) -> Result<()> {
    journal.sequence = journal.sequence.saturating_add(1);
    journal.updated_at = now_iso();
    let path = active.join(format!(
        "{JOURNAL_PREFIX}{:020}{JOURNAL_SUFFIX}",
        journal.sequence
    ));
    let mut temporary = NamedTempFile::new_in(active)?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), journal)?;
    temporary.as_file_mut().write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(path)
        .map_err(|error| Error::Io(error.error))?;
    Ok(())
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    Ok(serde_json::from_reader(BufReader::new(File::open(path)?))?)
}

fn write_json_file(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    serde_json::to_writer_pretty(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}

fn blocked_message(journal: &RestoreJournal, paths: &RestorePaths) -> String {
    format!(
        "{} Recovery files remain in '{}'.",
        journal
            .message
            .as_deref()
            .unwrap_or("Profile restore is blocked."),
        paths.active.display()
    )
}

fn cleanup_orphan_prepare_directories(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(".prepare-") || name.starts_with(".result-"))
        {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn remove_path_if_exists(path: &Path) -> Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn remove_restore_root_if_empty(root: &Path) {
    let _ = fs::remove_dir(root);
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
std::thread_local! {
    static RESTORE_TEST_FAILURES: std::cell::RefCell<std::collections::VecDeque<&'static str>> =
        const { std::cell::RefCell::new(std::collections::VecDeque::new()) };
}

#[cfg(test)]
fn set_restore_test_failures(points: &[&'static str]) {
    RESTORE_TEST_FAILURES.with(|failures| {
        *failures.borrow_mut() = points.iter().copied().collect();
    });
}

#[cfg(test)]
fn inject_restore_test_failure(point: &'static str) -> Result<()> {
    let should_fail = RESTORE_TEST_FAILURES.with(|failures| {
        let mut failures = failures.borrow_mut();
        if failures.front().is_some_and(|next| *next == point) {
            failures.pop_front();
            true
        } else {
            false
        }
    });
    if should_fail {
        return Err(Error::Custom(format!(
            "Injected profile restore test failure at {point}."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{Seek, SeekFrom};

    use chrono::TimeZone;
    use vrcx_0_persistence::config;

    use crate::{create_profile_backup, ProfileBackupKind, ProfileBackupRequest};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-profile-restore-{name}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_profile(app_data: &Path, marker: &str) {
        fs::create_dir_all(app_data).unwrap();
        let database = DatabaseService::new(&app_data.join(PROFILE_DATABASE_FILE)).unwrap();
        config::set_string(
            &database,
            "VRCX_0_databaseVersion",
            &current_vrcx0_schema_version().to_string(),
        )
        .unwrap();
        config::set_string(&database, "restoreMarker", marker).unwrap();
        drop(database);
        fs::write(
            app_data.join(PROFILE_CONFIG_FILE),
            serde_json::to_vec_pretty(&BTreeMap::from([(
                "profileMarker".to_string(),
                marker.to_string(),
            )]))
            .unwrap(),
        )
        .unwrap();
    }

    fn read_database_marker(app_data: &Path) -> String {
        let database = DatabaseService::new(&app_data.join(PROFILE_DATABASE_FILE)).unwrap();
        config::get_string(&database, "restoreMarker", "").unwrap()
    }

    fn read_config_marker(app_data: &Path) -> String {
        let config: BTreeMap<String, String> =
            serde_json::from_slice(&fs::read(app_data.join(PROFILE_CONFIG_FILE)).unwrap()).unwrap();
        config.get("profileMarker").cloned().unwrap_or_default()
    }

    fn create_backup(source: &Path, target: &Path) -> PathBuf {
        fs::create_dir_all(target).unwrap();
        let database = DatabaseService::new(&source.join(PROFILE_DATABASE_FILE)).unwrap();
        let config: HashMap<String, String> =
            serde_json::from_slice(&fs::read(source.join(PROFILE_CONFIG_FILE)).unwrap()).unwrap();
        create_profile_backup(
            ProfileBackupRequest {
                database: &database,
                config: &config,
                target_directory: target,
                created_at: Utc.with_ymd_and_hms(2026, 7, 13, 15, 30, 0).unwrap(),
                app_version: "test",
                kind: ProfileBackupKind::Manual,
            },
            |_| crate::ProfileBackupControl::Continue,
            || crate::ProfileBackupControl::Continue,
        )
        .unwrap()
        .path
    }

    #[test]
    fn restores_profile_then_keeps_rollback_until_confirmation() {
        let dir = TestDir::new("restore-confirm");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        let archive = create_backup(&source, &backups);

        let pending = prepare_profile_restore(&archive, &app_data).unwrap();
        assert_eq!(pending.status, ProfileRestoreStatus::PendingRestore);
        assert!(!automatic_profile_backups_allowed(&app_data));
        assert_eq!(
            consume_pending_profile_restore(&app_data).unwrap(),
            ProfileRestoreStartupOutcome::Restored
        );
        assert_eq!(read_database_marker(&app_data), "replacement");
        let state = profile_restore_state(&app_data).unwrap();
        assert_eq!(
            state.status,
            ProfileRestoreStatus::RestoredAwaitingConfirmation
        );
        assert!(!automatic_profile_backups_allowed(&app_data));

        assert_eq!(
            confirm_profile_restore(&app_data).unwrap().status,
            ProfileRestoreStatus::Idle
        );
        assert!(automatic_profile_backups_allowed(&app_data));
    }

    #[test]
    fn stages_and_restores_multi_megabyte_database() {
        let dir = TestDir::new("multi-megabyte");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        let database = DatabaseService::new(&source.join(PROFILE_DATABASE_FILE)).unwrap();
        config::set_string(
            &database,
            "restoreLargeFixture",
            &"x".repeat(6 * 1024 * 1024),
        )
        .unwrap();
        drop(database);
        let archive = create_backup(&source, &backups);

        prepare_profile_restore(&archive, &app_data).unwrap();
        assert_eq!(
            consume_pending_profile_restore(&app_data).unwrap(),
            ProfileRestoreStartupOutcome::Restored
        );
        assert_eq!(read_database_marker(&app_data), "replacement");
        let restored = DatabaseService::new(&app_data.join(PROFILE_DATABASE_FILE)).unwrap();
        assert_eq!(
            config::get_string(&restored, "restoreLargeFixture", "")
                .unwrap()
                .len(),
            6 * 1024 * 1024
        );
    }

    #[test]
    fn rolls_back_to_original_profile_and_persists_result() {
        let dir = TestDir::new("active-rollback");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        let archive = create_backup(&source, &backups);
        prepare_profile_restore(&archive, &app_data).unwrap();
        consume_pending_profile_restore(&app_data).unwrap();

        assert_eq!(
            request_profile_rollback(&app_data).unwrap().status,
            ProfileRestoreStatus::PendingRollback
        );
        assert!(!automatic_profile_backups_allowed(&app_data));
        let outcome = consume_pending_profile_restore(&app_data).unwrap();
        let rollback_state = profile_restore_state(&app_data).unwrap();
        assert_eq!(
            outcome,
            ProfileRestoreStartupOutcome::RollbackCompleted,
            "{rollback_state:?}"
        );
        assert_eq!(read_database_marker(&app_data), "original");
        let result = profile_restore_state(&app_data).unwrap();
        assert_eq!(result.status, ProfileRestoreStatus::RollbackCompleted);
        assert!(result.can_acknowledge);
        assert!(automatic_profile_backups_allowed(&app_data));
        assert_eq!(
            acknowledge_profile_restore_result(&app_data)
                .unwrap()
                .status,
            ProfileRestoreStatus::Idle
        );
    }

    #[test]
    fn automatically_rolls_back_when_restore_installation_fails() {
        let dir = TestDir::new("automatic-rollback");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        let archive = create_backup(&source, &backups);
        prepare_profile_restore(&archive, &app_data).unwrap();
        set_restore_test_failures(&[FAIL_RESTORE_AFTER_DATABASE_INSTALL]);

        assert_eq!(
            consume_pending_profile_restore(&app_data).unwrap(),
            ProfileRestoreStartupOutcome::RestoreFailedRolledBack
        );
        assert_eq!(read_database_marker(&app_data), "original");
        assert_eq!(read_config_marker(&app_data), "original");
        let state = profile_restore_state(&app_data).unwrap();
        assert_eq!(state.status, ProfileRestoreStatus::RestoreFailedRolledBack);
        assert!(state.can_acknowledge);
        assert!(automatic_profile_backups_allowed(&app_data));
    }

    #[test]
    fn resumes_capture_after_a_crash_between_move_and_journal_write() {
        let dir = TestDir::new("resume-capture");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        let archive = create_backup(&source, &backups);
        prepare_profile_restore(&archive, &app_data).unwrap();

        let paths = RestorePaths::new(&app_data);
        let mut journal = read_latest_journal(&paths.active).unwrap();
        journal.phase = RestoreTransactionPhase::CapturingCurrent;
        write_journal(&paths.active, &mut journal).unwrap();
        fs::rename(
            profile_path(&app_data, ProfileFileSlot::Database),
            profile_path(&paths.rollback(), ProfileFileSlot::Database),
        )
        .unwrap();

        assert_eq!(
            consume_pending_profile_restore(&app_data).unwrap(),
            ProfileRestoreStartupOutcome::Restored
        );
        assert_eq!(read_database_marker(&app_data), "replacement");
        assert_eq!(
            consume_pending_profile_restore(&app_data).unwrap(),
            ProfileRestoreStartupOutcome::None
        );
    }

    #[test]
    fn failed_active_rollback_restores_the_verified_replacement() {
        let dir = TestDir::new("rollback-redo");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        let archive = create_backup(&source, &backups);
        prepare_profile_restore(&archive, &app_data).unwrap();
        consume_pending_profile_restore(&app_data).unwrap();
        request_profile_rollback(&app_data).unwrap();
        set_restore_test_failures(&[FAIL_ROLLBACK_BEFORE_INSTALL]);

        assert_eq!(
            consume_pending_profile_restore(&app_data).unwrap(),
            ProfileRestoreStartupOutcome::None
        );
        assert_eq!(read_database_marker(&app_data), "replacement");
        let state = profile_restore_state(&app_data).unwrap();
        assert_eq!(
            state.status,
            ProfileRestoreStatus::RestoredAwaitingConfirmation
        );
        assert!(state.message.unwrap().contains("Rollback failed"));
    }

    #[test]
    fn blocks_startup_when_rollback_and_redo_restore_both_fail() {
        let dir = TestDir::new("rollback-blocked");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        let archive = create_backup(&source, &backups);
        prepare_profile_restore(&archive, &app_data).unwrap();
        consume_pending_profile_restore(&app_data).unwrap();
        request_profile_rollback(&app_data).unwrap();
        set_restore_test_failures(&[
            FAIL_ROLLBACK_BEFORE_INSTALL,
            FAIL_ROLLBACK_BEFORE_REDO_RESTORE,
        ]);

        let error = consume_pending_profile_restore(&app_data).unwrap_err();
        assert!(error.to_string().contains("Recovery files remain"));
        let state = profile_restore_state(&app_data).unwrap();
        assert_eq!(state.status, ProfileRestoreStatus::Blocked);
        assert!(state.message.unwrap().contains("profile-restore"));
        assert!(!automatic_profile_backups_allowed(&app_data));
    }

    #[test]
    fn rejects_future_schema_before_publishing_transaction() {
        let dir = TestDir::new("future-schema");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        let database = DatabaseService::new(&source.join(PROFILE_DATABASE_FILE)).unwrap();
        config::set_string(
            &database,
            "VRCX_0_databaseVersion",
            &(current_vrcx0_schema_version() + 1).to_string(),
        )
        .unwrap();
        drop(database);
        let archive = create_backup(&source, &backups);

        let error = prepare_profile_restore(&archive, &app_data).unwrap_err();
        assert!(error
            .to_string()
            .contains("Unsupported profile database schema"));
        assert_eq!(
            profile_restore_state(&app_data).unwrap().status,
            ProfileRestoreStatus::Idle
        );
        assert_eq!(read_database_marker(&app_data), "original");
    }

    #[test]
    fn rejects_non_string_config_values() {
        let dir = TestDir::new("non-string-config");
        let app_data = dir.path.join("app-data");
        write_profile(&app_data, "profile");
        fs::write(
            app_data.join(PROFILE_CONFIG_FILE),
            br#"{"invalidNumber":1}"#,
        )
        .unwrap();

        let error = validate_profile_files(
            &app_data.join(PROFILE_DATABASE_FILE),
            &app_data.join(PROFILE_CONFIG_FILE),
            None,
            true,
        )
        .unwrap_err();
        assert!(error.to_string().contains("invalid type"));
    }

    #[test]
    fn rejects_zero_and_manifest_mismatched_schema_versions() {
        let dir = TestDir::new("invalid-schema");
        let app_data = dir.path.join("app-data");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "profile");
        let archive = create_backup(&app_data, &backups);
        let mut manifest = crate::validate_profile_backup(&archive).unwrap();
        manifest.database_schema_version -= 1;

        let mismatch = validate_profile_files(
            &app_data.join(PROFILE_DATABASE_FILE),
            &app_data.join(PROFILE_CONFIG_FILE),
            Some(&manifest),
            true,
        )
        .unwrap_err();
        assert!(mismatch.to_string().contains("does not match manifest"));

        let database = DatabaseService::new(&app_data.join(PROFILE_DATABASE_FILE)).unwrap();
        config::set_string(&database, "VRCX_0_databaseVersion", "0").unwrap();
        drop(database);
        let zero = validate_profile_files(
            &app_data.join(PROFILE_DATABASE_FILE),
            &app_data.join(PROFILE_CONFIG_FILE),
            None,
            true,
        )
        .unwrap_err();
        assert!(zero
            .to_string()
            .contains("Unsupported profile database schema version 0"));
    }

    #[test]
    fn rejects_malformed_database_during_quick_check() {
        let dir = TestDir::new("quick-check");
        let app_data = dir.path.join("app-data");
        write_profile(&app_data, "profile");
        let database_path = app_data.join(PROFILE_DATABASE_FILE);
        let connection = rusqlite::Connection::open(&database_path).unwrap();
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        let page_size: i64 = connection
            .query_row("PRAGMA page_size", [], |row| row.get(0))
            .unwrap();
        let root_page: i64 = connection
            .query_row(
                "SELECT rootpage FROM sqlite_schema WHERE name = 'configs'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        drop(connection);
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&database_path)
            .unwrap();
        file.seek(SeekFrom::Start(
            u64::try_from((root_page - 1) * page_size).unwrap(),
        ))
        .unwrap();
        file.write_all(&[0]).unwrap();
        file.sync_all().unwrap();

        let error = validate_profile_files(
            &database_path,
            &app_data.join(PROFILE_CONFIG_FILE),
            None,
            true,
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("database disk image is malformed"),
            "{error}"
        );
    }

    #[test]
    fn accepts_valid_backup_renamed_to_zip() {
        let dir = TestDir::new("renamed-zip");
        let app_data = dir.path.join("app-data");
        let source = dir.path.join("source");
        let backups = dir.path.join("backups");
        write_profile(&app_data, "original");
        write_profile(&source, "replacement");
        fs::write(source.join(PROFILE_CONFIG_FILE), r#"{"not":"bad"}"#).unwrap();
        let archive = create_backup(&source, &backups);
        let renamed = backups.join("renamed.zip");
        fs::rename(&archive, &renamed).unwrap();

        prepare_profile_restore(&renamed, &app_data).unwrap();
        assert_eq!(
            profile_restore_state(&app_data).unwrap().status,
            ProfileRestoreStatus::PendingRestore
        );
    }
}
