import type {
    ProfileBackupErrorCode,
    ProfileBackupPhase,
    ProfileBackupStatus,
    ProfileRestoreFailureCode
} from './profileBackupService';

const UNKNOWN_ERROR_KEY = 'profile_backup.error.unknown';

const PROFILE_BACKUP_PHASE_KEYS: Record<ProfileBackupPhase, string> = {
    snapshot: 'profile_backup.phase_snapshot',
    package: 'profile_backup.phase_package',
    deliver: 'profile_backup.phase_deliver'
};

const PROFILE_BACKUP_ERROR_KEYS: Record<ProfileBackupErrorCode, string> = {
    operationBusy: 'profile_backup.error.busy',
    deliveryPending: 'profile_backup.error.delivery_pending',
    pendingRestore: 'profile_backup.error.pending_restore',
    pendingDataDirMigration: 'data_dir_migration.error.pendingMigration',
    directoryUnavailable: 'profile_backup.error.directory_unavailable',
    permissionDenied: 'profile_backup.error.permission_denied',
    localDiskFull: 'profile_backup.error.local_disk_full',
    targetDiskFull: 'profile_backup.error.target_disk_full',
    deviceRemoved: 'profile_backup.error.device_removed',
    alreadyExists: 'profile_backup.error.already_exists',
    artifactMissing: 'profile_backup.error.backup_unavailable',
    snapshotFailed: 'profile_backup.error.snapshot_failed',
    packageFailed: 'profile_backup.error.package_failed',
    io: 'profile_backup.error.io'
};

const PROFILE_RESTORE_VALIDATION_ERROR_KEYS: Record<
    ProfileRestoreFailureCode,
    string
> = {
    operationBusy: 'profile_backup.error.busy',
    pendingRestore: 'profile_backup.error.pending_restore',
    pendingDataDirMigration: 'data_dir_migration.error.pendingMigration',
    invalidArchive: 'profile_backup.error.invalid_archive',
    invalidEntries: 'profile_backup.error.invalid_archive',
    unsupportedManifestVersion: 'profile_backup.error.unsupported_manifest',
    invalidAppVersion: 'profile_backup.error.invalid_archive',
    newerAppVersion: 'profile_backup.error.newer_app_version',
    newerDatabaseVersion: 'profile_backup.error.newer_database_version',
    contentSizeMismatch: 'profile_backup.error.checksum_mismatch',
    contentHashMismatch: 'profile_backup.error.checksum_mismatch',
    validationExpired: 'profile_backup.error.validation_expired',
    databaseCheckFailed: 'profile_backup.error.database_corrupt',
    notProfileDatabase: 'profile_backup.error.not_vrcx0_profile',
    databaseVersionMismatch: 'profile_backup.error.database_corrupt',
    stagingCorrupted: 'profile_backup.restore_failure.staging_corrupted',
    databaseOpenFailed: 'profile_backup.restore_failure.db_open_failed',
    io: 'profile_backup.error.io'
};

export function profileBackupErrorKey(code: ProfileBackupErrorCode): string {
    return PROFILE_BACKUP_ERROR_KEYS[code] ?? UNKNOWN_ERROR_KEY;
}

export function profileBackupPhaseKey(status: ProfileBackupStatus): string {
    if (status.phase === 'deliver' && status.percent === null) {
        return 'profile_backup.phase_finalize';
    }
    if (status.phase) {
        return PROFILE_BACKUP_PHASE_KEYS[status.phase];
    }
    return status.kind === 'auto'
        ? 'profile_backup.automatic_running'
        : 'profile_backup.manual_running';
}

export function profileRestoreFailureKey(
    code: ProfileRestoreFailureCode
): string {
    return PROFILE_RESTORE_VALIDATION_ERROR_KEYS[code] ?? UNKNOWN_ERROR_KEY;
}

export function profileRestoreRollbackErrorKey(
    code: ProfileBackupErrorCode
): string {
    switch (code) {
        case 'operationBusy':
            return 'profile_backup.rollback_error.busy';
        case 'pendingRestore':
            return 'profile_backup.rollback_error.protected';
        case 'pendingDataDirMigration':
            return 'data_dir_migration.error.pendingMigration';
        case 'io':
            return 'profile_backup.rollback_error.io';
        default:
            return UNKNOWN_ERROR_KEY;
    }
}
