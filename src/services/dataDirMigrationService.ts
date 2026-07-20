import {
    commands,
    type DataDirCleanupReport,
    type DataDirMigrationActionOutcome,
    type DataDirMigrationMode,
    type DataDirMigrationPlan,
    type DataDirMigrationResult,
    type DataDirMigrationStatus
} from '@/platform/tauri/bindings';

export type {
    DataDirCleanupPending,
    DataDirCleanupReport,
    DataDirMigrationActionOutcome,
    DataDirMigrationError,
    DataDirMigrationErrorCode,
    DataDirMigrationMode,
    DataDirMigrationPhase,
    DataDirMigrationPlan,
    DataDirMigrationResult,
    DataDirMigrationResultStatus,
    DataDirMigrationState,
    DataDirMigrationStatus,
    DataDirMigrationTargetState,
    DataDirMigrationWarning
} from '@/platform/tauri/bindings';

export function planDataDirMigration(
    path: string
): Promise<DataDirMigrationPlan> {
    return commands.appPlanDataDirMigration(path);
}

export function requestDataDirMigration(
    path: string,
    mode: DataDirMigrationMode
): Promise<DataDirMigrationActionOutcome> {
    return commands.appRequestDataDirMigration(path, mode);
}

export function cancelDataDirMigration(): Promise<DataDirMigrationActionOutcome> {
    return commands.appCancelDataDirMigration();
}

export function getCurrentDataDirMigrationStatus(): Promise<DataDirMigrationStatus> {
    return commands.appDataDirMigrationCurrentStatus();
}

export function takeDataDirMigrationResult(): Promise<DataDirMigrationResult | null> {
    return commands.appTakeDataDirMigrationResult();
}

export function cleanupMigratedDataDir(): Promise<DataDirCleanupReport | null> {
    return commands.appCleanupMigratedDataDir();
}

export async function dismissDataDirCleanup(): Promise<void> {
    await commands.appDismissDataDirCleanup();
}

export async function markDataDirCleanupPrompted(
    promptedAt: string
): Promise<void> {
    await commands.appMarkDataDirCleanupPrompted(promptedAt);
}
