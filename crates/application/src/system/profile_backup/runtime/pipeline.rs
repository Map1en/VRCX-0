use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Local, Utc};
use vrcx_0_persistence::data_dir_migration::has_pending_data_dir_migration;
use vrcx_0_persistence::profile_backup::{
    commit_file_without_overwrite, create_backup_archive_with_progress,
    has_pending_profile_restore, is_auto_backup_file_name, read_profile_database_version,
    select_auto_backups_for_removal, ProfileBackupManifestMetadata, BACKUP_STAGING_DIRECTORY,
    DATABASE_FILE_NAME,
};
use vrcx_0_persistence::Error as PersistenceError;

use vrcx_0_application_core::TaskStopToken;

use super::{
    OperationGuard, PendingDelivery, ProfileBackupActionOutcome, ProfileBackupError,
    ProfileBackupErrorCode, ProfileBackupKind, ProfileBackupPhase, ProfileBackupRuntime, AUTO_JOB,
    LAST_AUTO_AT_KEY, ORPHAN_TEMP_MAX_AGE,
};

impl ProfileBackupRuntime {
    pub fn run_manual(&self, target_path: impl Into<PathBuf>) -> ProfileBackupActionOutcome {
        let target_path = target_path.into();
        let Some(file_name) = target_path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
        else {
            return self.rejected_action(
                ProfileBackupErrorCode::DirectoryUnavailable,
                Some(target_path),
            );
        };
        if target_path.extension().and_then(|value| value.to_str()) != Some("vrcx0backup") {
            return self.rejected_action(
                ProfileBackupErrorCode::DirectoryUnavailable,
                Some(target_path),
            );
        }
        if is_auto_backup_file_name(&file_name) {
            return self.rejected_action(ProfileBackupErrorCode::AlreadyExists, Some(target_path));
        }
        let Some(target_dir) = target_path
            .parent()
            .filter(|value| !value.as_os_str().is_empty())
            .map(Path::to_path_buf)
        else {
            return self.rejected_action(
                ProfileBackupErrorCode::DirectoryUnavailable,
                Some(target_path),
            );
        };
        self.start_backup(ProfileBackupKind::Manual, target_dir, file_name)
    }

    pub(super) fn start_auto_backup(&self, target_dir: PathBuf) -> ProfileBackupActionOutcome {
        self.start_backup(
            ProfileBackupKind::Auto,
            target_dir,
            backup_file_name(ProfileBackupKind::Auto, Local::now()),
        )
    }

    pub fn retry_delivery(&self) -> ProfileBackupActionOutcome {
        let Some(guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return self.rejected_action(ProfileBackupErrorCode::OperationBusy, None);
        };
        let pending = self
            .inner
            .state
            .lock()
            .ok()
            .and_then(|state| state.pending_delivery.clone());
        let Some(pending) = pending else {
            return self.rejected_action_with_guard(
                guard,
                ProfileBackupErrorCode::ArtifactMissing,
                None,
            );
        };
        if !pending.archive.is_file() {
            self.finish_failure(
                pending.kind,
                ProfileBackupError {
                    code: ProfileBackupErrorCode::ArtifactMissing,
                    path: Some(pending.archive.to_string_lossy().into_owned()),
                },
                None,
            );
            return self.rejected_action_with_guard(
                guard,
                ProfileBackupErrorCode::ArtifactMissing,
                Some(pending.archive),
            );
        }
        self.begin_running(pending.kind, ProfileBackupPhase::Deliver, Some(0));
        self.spawn_delivery(pending, guard, DeliveryAttempt::Retry);
        self.accepted_action()
    }

    pub(super) fn start_backup(
        &self,
        kind: ProfileBackupKind,
        target_dir: PathBuf,
        file_name: String,
    ) -> ProfileBackupActionOutcome {
        let Some(guard) = OperationGuard::try_acquire(&self.inner.operation_gate) else {
            return self.rejected_action(ProfileBackupErrorCode::OperationBusy, None);
        };
        if has_pending_profile_restore(&self.inner.app_data) {
            return self.rejected_action_with_guard(
                guard,
                ProfileBackupErrorCode::PendingRestore,
                None,
            );
        }
        if has_pending_data_dir_migration(&self.inner.control_dir) {
            return self.rejected_action_with_guard(
                guard,
                ProfileBackupErrorCode::PendingDataDirMigration,
                None,
            );
        }
        let stale_auto_delivery = match self.inner.state.lock() {
            Ok(mut state) => {
                let replace_stale_auto = kind == ProfileBackupKind::Auto
                    && state
                        .pending_delivery
                        .as_ref()
                        .is_some_and(|pending| pending.kind == ProfileBackupKind::Auto);
                if replace_stale_auto {
                    Ok(state.pending_delivery.take())
                } else if state.pending_delivery.is_some() {
                    Err(ProfileBackupErrorCode::DeliveryPending)
                } else {
                    Ok(None)
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to inspect pending profile backup delivery");
                Err(ProfileBackupErrorCode::OperationBusy)
            }
        };
        let stale_auto_delivery = match stale_auto_delivery {
            Ok(pending) => pending,
            Err(code) => {
                return self.rejected_action_with_guard(guard, code, None);
            }
        };
        if let Some(pending) = stale_auto_delivery {
            if let Err(error) = fs::remove_file(&pending.archive) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(
                        error = %error,
                        path = %pending.archive.display(),
                        "failed to remove stale automatic profile backup"
                    );
                }
            }
        }
        let settings = self.settings();
        let pending = PendingDelivery {
            archive: self
                .inner
                .app_data
                .join(BACKUP_STAGING_DIRECTORY)
                .join(&file_name),
            target_dir,
            file_name,
            kind,
            retain_extra: settings.auto_retain_extra,
        };
        self.begin_running(kind, ProfileBackupPhase::Snapshot, None);
        let runtime = self.clone();
        self.inner
            .tasks
            .spawn_cancellable_thread("profile-backup", move |stop_token| {
                runtime.run_backup_pipeline(pending, guard, stop_token)
            });
        self.accepted_action()
    }

    fn run_backup_pipeline(
        &self,
        pending: PendingDelivery,
        guard: OperationGuard,
        stop_token: TaskStopToken,
    ) {
        let staging_dir = self.inner.app_data.join(BACKUP_STAGING_DIRECTORY);
        let snapshot = staging_dir.join(DATABASE_FILE_NAME);
        if let Err(error) = reset_directory(&staging_dir) {
            self.fail_stage(pending.kind, error, BackupStage::Local, &staging_dir);
            return;
        }
        if stop_token.is_stop_requested() {
            return;
        }
        let snapshot_result = self.inner.db.vacuum_into(&snapshot);
        if let Err(error) = snapshot_result {
            self.fail_persistence_stage(pending.kind, error, BackupStage::Snapshot, &snapshot);
            let _ = fs::remove_dir_all(&staging_dir);
            return;
        }
        if stop_token.is_stop_requested() {
            return;
        }
        self.update_progress(ProfileBackupPhase::Package, Some(0));
        let db_version = match read_profile_database_version(&snapshot) {
            Ok(version) => version,
            Err(error) => {
                self.fail_persistence_stage(pending.kind, error, BackupStage::Package, &snapshot);
                let _ = fs::remove_dir_all(&staging_dir);
                return;
            }
        };
        let available_parallelism = std::thread::available_parallelism()
            .map(std::num::NonZeroUsize::get)
            .unwrap_or(1);
        let archive_result = create_backup_archive_with_progress(
            &snapshot,
            &pending.archive,
            ProfileBackupManifestMetadata {
                app_version: self.inner.app_version.clone(),
                db_version,
                created_at: Utc::now().to_rfc3339(),
                platform: std::env::consts::OS.into(),
                kind: pending.kind,
            },
            compression_workers(pending.kind, available_parallelism),
            &mut |bytes, total| {
                self.update_progress(
                    ProfileBackupPhase::Package,
                    Some(active_stage_percent(bytes, total)),
                );
            },
        );
        let _ = fs::remove_file(&snapshot);
        if let Err(error) = archive_result {
            self.fail_persistence_stage(
                pending.kind,
                error,
                BackupStage::Package,
                &pending.archive,
            );
            let _ = fs::remove_dir_all(&staging_dir);
            return;
        }
        if stop_token.is_stop_requested() {
            return;
        }
        self.update_progress(ProfileBackupPhase::Package, Some(100));
        self.set_pending_delivery(Some(pending.clone()));
        self.run_delivery(pending, guard, stop_token, DeliveryAttempt::Initial);
    }

    fn spawn_delivery(
        &self,
        pending: PendingDelivery,
        guard: OperationGuard,
        attempt: DeliveryAttempt,
    ) {
        let runtime = self.clone();
        self.inner
            .tasks
            .spawn_cancellable_thread("profile-backup-delivery", move |stop_token| {
                runtime.run_delivery(pending, guard, stop_token, attempt)
            });
    }

    fn run_delivery(
        &self,
        pending: PendingDelivery,
        _guard: OperationGuard,
        stop_token: TaskStopToken,
        attempt: DeliveryAttempt,
    ) {
        self.update_progress(ProfileBackupPhase::Deliver, Some(0));
        if let Err(error) = self.deliver_archive(&pending, &stop_token, attempt) {
            let backup_error = classify_io_error(error, BackupStage::Target, &pending.target_dir);
            self.finish_failure(pending.kind, backup_error, Some(pending));
            return;
        }
        if stop_token.is_stop_requested() {
            return;
        }
        self.update_progress(ProfileBackupPhase::Deliver, Some(100));
        let final_path = pending.target_dir.join(&pending.file_name);
        let _ = fs::remove_file(&pending.archive);
        self.set_pending_delivery(None);
        if pending.kind == ProfileBackupKind::Auto {
            let completed_at = Utc::now().to_rfc3339();
            self.inner
                .storage
                .set(LAST_AUTO_AT_KEY.into(), completed_at);
            rotate_auto_backups(&pending.target_dir, pending.retain_extra);
            self.inner
                .background_jobs
                .mark_completed(AUTO_JOB, "Profile backup completed.");
        }
        self.finish_success(pending.kind, final_path);
    }

    fn deliver_archive(
        &self,
        pending: &PendingDelivery,
        stop_token: &TaskStopToken,
        attempt: DeliveryAttempt,
    ) -> std::io::Result<()> {
        ensure_directory_writable(&pending.target_dir)?;
        cleanup_orphan_temporary_files(&pending.target_dir);
        let final_path = pending.target_dir.join(&pending.file_name);
        let temporary_path = pending
            .target_dir
            .join(format!("{}.tmp", pending.file_name));
        let total = fs::metadata(&pending.archive)?.len().max(1);
        let mut reader = BufReader::new(File::open(&pending.archive)?);
        let temporary = create_delivery_temporary(&temporary_path, attempt)?;
        let mut writer = BufWriter::new(temporary);
        let mut copied = 0_u64;
        let mut buffer = [0_u8; 128 * 1024];
        let result = (|| {
            loop {
                if stop_token.is_stop_requested() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Interrupted,
                        "profile backup delivery stopped",
                    ));
                }
                let read = reader.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read])?;
                copied += read as u64;
                self.update_progress(
                    ProfileBackupPhase::Deliver,
                    Some(active_stage_percent(copied, total)),
                );
            }
            self.update_progress(ProfileBackupPhase::Deliver, None);
            writer.flush()?;
            writer.get_ref().sync_all()?;
            drop(writer);
            commit_file_without_overwrite(&temporary_path, &final_path).map_err(persistence_io)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary_path);
        }
        result
    }

    fn fail_stage(
        &self,
        kind: ProfileBackupKind,
        error: std::io::Error,
        stage: BackupStage,
        path: &Path,
    ) {
        tracing::warn!(error = %error, path = %path.display(), "profile backup stage failed");
        self.finish_failure(kind, classify_io_error(error, stage, path), None);
    }

    fn fail_persistence_stage(
        &self,
        kind: ProfileBackupKind,
        error: PersistenceError,
        stage: BackupStage,
        path: &Path,
    ) {
        tracing::warn!(error = %error, path = %path.display(), "profile backup stage failed");
        let backup_error = match error {
            PersistenceError::Io(error) => classify_io_error(error, stage, path),
            _ => ProfileBackupError {
                code: match stage {
                    BackupStage::Snapshot => ProfileBackupErrorCode::SnapshotFailed,
                    BackupStage::Package => ProfileBackupErrorCode::PackageFailed,
                    BackupStage::Local | BackupStage::Target => ProfileBackupErrorCode::Io,
                },
                path: Some(path.to_string_lossy().into_owned()),
            },
        };
        self.finish_failure(kind, backup_error, None);
    }
}

pub(super) fn active_stage_percent(processed: u64, total: u64) -> u8 {
    (processed.saturating_mul(100) / total.max(1)).min(99) as u8
}

pub(super) fn compression_workers(kind: ProfileBackupKind, available_parallelism: usize) -> u32 {
    match kind {
        ProfileBackupKind::Auto => 0,
        ProfileBackupKind::Manual => available_parallelism.saturating_sub(1).clamp(1, 16) as u32,
    }
}

#[derive(Clone, Copy)]
enum BackupStage {
    Snapshot,
    Package,
    Local,
    Target,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(super) enum DeliveryAttempt {
    Initial,
    Retry,
}

pub(super) fn backup_file_name(kind: ProfileBackupKind, now: DateTime<Local>) -> String {
    let marker = if kind == ProfileBackupKind::Auto {
        "auto-"
    } else {
        ""
    };
    format!(
        "VRCX-0-backup-{marker}{}.vrcx0backup",
        now.format("%Y%m%d-%H%M%S")
    )
}

fn reset_directory(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    fs::create_dir_all(path)
}

fn ensure_directory_writable(path: &Path) -> std::io::Result<()> {
    if !path.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "profile backup target directory is unavailable",
        ));
    }
    let probe = path.join(format!(
        ".vrcx0-write-test-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let result = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .and_then(|file| file.sync_all());
    let _ = fs::remove_file(probe);
    result
}

pub(super) fn create_delivery_temporary(
    path: &Path,
    attempt: DeliveryAttempt,
) -> std::io::Result<File> {
    if attempt == DeliveryAttempt::Retry {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;

        options.mode(0o600);
    }
    options.open(path)
}

fn cleanup_orphan_temporary_files(directory: &Path) {
    let now = SystemTime::now();
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let matches = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(is_backup_temporary_file_name);
        if !matches {
            continue;
        }
        let is_old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > ORPHAN_TEMP_MAX_AGE);
        if is_old {
            let _ = fs::remove_file(path);
        }
    }
}

pub(super) fn is_backup_temporary_file_name(name: &str) -> bool {
    name.ends_with(".vrcx0backup.tmp")
}

fn rotate_auto_backups(directory: &Path, retain_extra: u8) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let paths = entries
        .flatten()
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    for path in select_auto_backups_for_removal(paths, 1 + usize::from(retain_extra)) {
        if let Err(error) = fs::remove_file(&path) {
            tracing::warn!(error = %error, path = %path.display(), "failed to rotate profile backup");
        }
    }
}

fn persistence_io(error: PersistenceError) -> std::io::Error {
    match error {
        PersistenceError::Io(error) => error,
        other => std::io::Error::other(other.to_string()),
    }
}

#[cfg(windows)]
fn is_device_removed_os_error(code: Option<i32>) -> bool {
    matches!(code, Some(21 | 55 | 1167))
}

#[cfg(not(windows))]
fn is_device_removed_os_error(code: Option<i32>) -> bool {
    matches!(code, Some(6 | 19))
}

fn classify_io_error(error: std::io::Error, stage: BackupStage, path: &Path) -> ProfileBackupError {
    let code = match error.kind() {
        std::io::ErrorKind::AlreadyExists => ProfileBackupErrorCode::AlreadyExists,
        std::io::ErrorKind::PermissionDenied => ProfileBackupErrorCode::PermissionDenied,
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => {
            ProfileBackupErrorCode::DirectoryUnavailable
        }
        std::io::ErrorKind::StorageFull => match stage {
            BackupStage::Target => ProfileBackupErrorCode::TargetDiskFull,
            _ => ProfileBackupErrorCode::LocalDiskFull,
        },
        _ if is_device_removed_os_error(error.raw_os_error()) => {
            ProfileBackupErrorCode::DeviceRemoved
        }
        _ => ProfileBackupErrorCode::Io,
    };
    ProfileBackupError {
        code,
        path: Some(path.to_string_lossy().into_owned()),
    }
}
