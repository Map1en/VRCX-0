import { commands } from '@/platform/tauri/bindings';
import type {
    ProfileBackupJobState,
    ProfileBackupJobStatus,
    ProfileBackupProgress,
    ProfileBackupStage
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';

export const PROFILE_BACKUP_DIRECTORY_CONFIG_KEY = 'profileBackupDirectory';
export const PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY =
    'profileBackupAutomaticEnabled';
export const PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY =
    'profileBackupIntervalDays';
export const PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY =
    'profileBackupRetentionCount';
export const PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY =
    'profileBackupLastAutomaticAt';
export const PROFILE_BACKUP_JOB_STATUS_EVENT = 'profileBackupJobStatus';

export const PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT = 7;
export const PROFILE_BACKUP_INTERVAL_DAYS_MIN = 1;
export const PROFILE_BACKUP_INTERVAL_DAYS_MAX = 30;
export const PROFILE_BACKUP_RETENTION_COUNT_DEFAULT = 3;
export const PROFILE_BACKUP_RETENTION_COUNT_MIN = 1;
export const PROFILE_BACKUP_RETENTION_COUNT_MAX = 10;

export type AutomaticProfileBackupSettings = {
    enabled: boolean;
    intervalDays: number;
    retentionCount: number;
    lastAutomaticAt: string;
};

export type ProfileBackupSettings = {
    directory: string;
    automatic: AutomaticProfileBackupSettings;
};

export const PROFILE_BACKUP_STAGES: readonly ProfileBackupStage[] = [
    'databaseSnapshot',
    'hashing',
    'packaging',
    'validating',
    'publishing'
];

const JOB_STATE_RANK: Record<ProfileBackupJobState, number> = {
    idle: 0,
    running: 1,
    cancelling: 2,
    completed: 3,
    failed: 3,
    cancelled: 3
};

const TERMINAL_JOB_STATES = new Set<ProfileBackupJobState>([
    'completed',
    'failed',
    'cancelled'
]);

export const IDLE_PROFILE_BACKUP_JOB_STATUS: ProfileBackupJobStatus = {
    jobId: 0,
    state: 'idle',
    kind: null,
    progress: null,
    cancelRequested: false,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    result: null,
    lastError: null
};

export function isProfileBackupJobActive(
    status: ProfileBackupJobStatus
): boolean {
    return status.state === 'running' || status.state === 'cancelling';
}

export function isProfileBackupJobTerminal(
    status: ProfileBackupJobStatus
): boolean {
    return TERMINAL_JOB_STATES.has(status.state);
}

function stageIndex(stage: ProfileBackupStage): number {
    return PROFILE_BACKUP_STAGES.indexOf(stage);
}

function phaseRatio(progress: ProfileBackupProgress): number {
    if (progress.total <= 0) {
        return 0;
    }
    return Math.min(1, Math.max(0, progress.completed / progress.total));
}

function progressPosition(progress: ProfileBackupProgress | null): number {
    if (!progress) {
        return -1;
    }
    return Math.max(0, stageIndex(progress.stage)) + phaseRatio(progress);
}

export function profileBackupPhasePercent(
    progress: ProfileBackupProgress | null
): number {
    return progress ? Math.round(phaseRatio(progress) * 100) : 0;
}

export function profileBackupOverallPercent(
    progress: ProfileBackupProgress | null
): number {
    if (!progress) {
        return 0;
    }
    const position = progressPosition(progress);
    return Math.round((position / PROFILE_BACKUP_STAGES.length) * 100);
}

export function mergeProfileBackupJobStatus(
    current: ProfileBackupJobStatus,
    incoming: ProfileBackupJobStatus
): ProfileBackupJobStatus {
    if (incoming.jobId < current.jobId) {
        return current;
    }
    if (incoming.jobId > current.jobId) {
        return incoming;
    }
    if (isProfileBackupJobTerminal(current)) {
        return current;
    }
    if (JOB_STATE_RANK[incoming.state] < JOB_STATE_RANK[current.state]) {
        return current;
    }

    const progress =
        progressPosition(incoming.progress) >=
        progressPosition(current.progress)
            ? incoming.progress
            : current.progress;
    return {
        ...incoming,
        progress
    };
}

export async function getProfileBackupDirectory(): Promise<string> {
    return (
        await configRepository.getString(
            PROFILE_BACKUP_DIRECTORY_CONFIG_KEY,
            ''
        )
    ).trim();
}

export async function getProfileBackupSettings(): Promise<ProfileBackupSettings> {
    await configRepository.reload();
    const [directory, automatic] = await Promise.all([
        getProfileBackupDirectory(),
        getAutomaticProfileBackupSettings()
    ]);
    return { directory, automatic };
}

export async function getAutomaticProfileBackupSettings(): Promise<AutomaticProfileBackupSettings> {
    const [enabled, intervalDays, retentionCount, lastAutomaticAt] =
        await Promise.all([
            configRepository.getBool(
                PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY,
                false
            ),
            configRepository.getInt(
                PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY,
                PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT
            ),
            configRepository.getInt(
                PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY,
                PROFILE_BACKUP_RETENTION_COUNT_DEFAULT
            ),
            configRepository.getString(
                PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY,
                ''
            )
        ]);

    return {
        enabled,
        intervalDays: normalizeBoundedInteger(
            intervalDays,
            PROFILE_BACKUP_INTERVAL_DAYS_MIN,
            PROFILE_BACKUP_INTERVAL_DAYS_MAX,
            PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT
        ),
        retentionCount: normalizeBoundedInteger(
            retentionCount,
            PROFILE_BACKUP_RETENTION_COUNT_MIN,
            PROFILE_BACKUP_RETENTION_COUNT_MAX,
            PROFILE_BACKUP_RETENTION_COUNT_DEFAULT
        ),
        lastAutomaticAt: lastAutomaticAt.trim()
    };
}

export async function setAutomaticProfileBackupEnabled(
    enabled: boolean
): Promise<void> {
    await configRepository.setBool(
        PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY,
        enabled
    );
}

export async function setAutomaticProfileBackupIntervalDays(
    intervalDays: number
): Promise<number> {
    const normalized = requireBoundedInteger(
        intervalDays,
        PROFILE_BACKUP_INTERVAL_DAYS_MIN,
        PROFILE_BACKUP_INTERVAL_DAYS_MAX,
        'Automatic backup interval'
    );
    await configRepository.setInt(
        PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY,
        normalized
    );
    return normalized;
}

export async function setAutomaticProfileBackupRetentionCount(
    retentionCount: number
): Promise<number> {
    const normalized = requireBoundedInteger(
        retentionCount,
        PROFILE_BACKUP_RETENTION_COUNT_MIN,
        PROFILE_BACKUP_RETENTION_COUNT_MAX,
        'Automatic backup retention count'
    );
    await configRepository.setInt(
        PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY,
        normalized
    );
    return normalized;
}

export async function chooseProfileBackupDirectory(
    currentDirectory: string
): Promise<string | null> {
    const selected = (
        await commands.appOpenFolderSelectorDialog(
            currentDirectory.trim() || null
        )
    ).trim();
    if (!selected) {
        return null;
    }
    await configRepository.setString(
        PROFILE_BACKUP_DIRECTORY_CONFIG_KEY,
        selected
    );
    return selected;
}

export async function getProfileBackupJobStatus(): Promise<ProfileBackupJobStatus> {
    return commands.appProfileBackupJobStatusGet();
}

export async function startManualProfileBackup(
    targetDirectory: string
): Promise<ProfileBackupJobStatus> {
    const directory = targetDirectory.trim();
    if (!directory) {
        throw new Error('Backup directory is not configured.');
    }
    return commands.appProfileBackupManualStart(directory);
}

export async function cancelProfileBackupJob(
    jobId: number
): Promise<ProfileBackupJobStatus> {
    return commands.appProfileBackupJobCancel(jobId);
}

function normalizeBoundedInteger(
    value: number,
    min: number,
    max: number,
    defaultValue: number
): number {
    return Number.isInteger(value) && value >= min && value <= max
        ? value
        : defaultValue;
}

function requireBoundedInteger(
    value: number,
    min: number,
    max: number,
    label: string
): number {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${label} must be an integer from ${min} to ${max}.`);
    }
    return value;
}
