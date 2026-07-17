import {
    commands,
    type ProfileBackupActionOutcome,
    type ProfileBackupSettings,
    type ProfileBackupStatus,
    type ProfileRestoreResult,
    type ProfileRestoreRollbackCleanupOutcome,
    type ProfileRestoreRollbackState,
    type ProfileRestoreValidationOutcome
} from '@/platform/tauri/bindings';

export type {
    ProfileBackupActionOutcome,
    ProfileBackupError,
    ProfileBackupErrorCode,
    ProfileBackupKind,
    ProfileBackupOutcome,
    ProfileBackupPhase,
    ProfileBackupSettings,
    ProfileBackupState,
    ProfileBackupStatus,
    ProfileRestoreDataDisposition,
    ProfileRestoreFailure,
    ProfileRestoreFailureCode,
    ProfileRestoreManifestSummary,
    ProfileRestoreResult,
    ProfileRestoreProgress,
    ProfileRestoreProgressOperation,
    ProfileRestoreProgressPhase,
    ProfileRestoreRollbackCleanupOutcome,
    ProfileRestoreRollbackState,
    ProfileRestoreValidation,
    ProfileRestoreValidationOutcome
} from '@/platform/tauri/bindings';

export function getProfileBackupSettings(): Promise<ProfileBackupSettings> {
    return commands.appProfileBackupGetSettings();
}

export function setProfileBackupSettings(
    settings: ProfileBackupSettings
): Promise<ProfileBackupSettings> {
    return commands.appProfileBackupSetSettings(settings);
}

export function runManualProfileBackup(
    targetPath: string
): Promise<ProfileBackupActionOutcome> {
    return commands.appProfileBackupRunManual(targetPath);
}

export function retryProfileBackupDelivery(): Promise<ProfileBackupActionOutcome> {
    return commands.appProfileBackupRetryDelivery();
}

export function discardPendingProfileBackup(): Promise<ProfileBackupActionOutcome> {
    return commands.appProfileBackupDiscardPending();
}

export function dismissProfileBackupError(): Promise<ProfileBackupStatus> {
    return commands.appProfileBackupDismissError();
}

export function getCurrentProfileBackupStatus(): Promise<ProfileBackupStatus> {
    return commands.appProfileBackupCurrentStatus();
}

export function validateProfileRestore(
    path: string
): Promise<ProfileRestoreValidationOutcome> {
    return commands.appProfileRestoreValidate(path);
}

export function requestProfileRestore(
    expectedSha256: string
): Promise<ProfileRestoreValidationOutcome> {
    return commands.appProfileRestoreRequest(expectedSha256);
}

export async function discardStagedProfileRestore(): Promise<void> {
    await commands.appProfileRestoreDiscardStaged();
}

export function takeLastProfileRestoreResult(): Promise<ProfileRestoreResult | null> {
    return commands.appProfileRestoreTakeLastResult();
}

export function getProfileRestoreRollbackState(): Promise<ProfileRestoreRollbackState> {
    return commands.appProfileRestoreRollbackState();
}

export function clearProfileRestoreRollback(): Promise<ProfileRestoreRollbackCleanupOutcome> {
    return commands.appProfileRestoreClearRollback();
}
