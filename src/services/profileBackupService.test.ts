import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileBackupJobStatus } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appOpenFolderSelectorDialog: vi.fn(),
    appProfileBackupJobCancel: vi.fn(),
    appProfileBackupManualStart: vi.fn(),
    getString: vi.fn(),
    setString: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appOpenFolderSelectorDialog: mocks.appOpenFolderSelectorDialog,
        appProfileBackupJobCancel: mocks.appProfileBackupJobCancel,
        appProfileBackupManualStart: mocks.appProfileBackupManualStart
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: mocks.getString,
        setString: mocks.setString
    }
}));

import {
    chooseProfileBackupDirectory,
    IDLE_PROFILE_BACKUP_JOB_STATUS,
    mergeProfileBackupJobStatus,
    profileBackupOverallPercent,
    profileBackupPhasePercent,
    PROFILE_BACKUP_DIRECTORY_CONFIG_KEY,
    startManualProfileBackup
} from './profileBackupService';

function status(
    overrides: Partial<ProfileBackupJobStatus>
): ProfileBackupJobStatus {
    return {
        ...IDLE_PROFILE_BACKUP_JOB_STATUS,
        ...overrides
    };
}

describe('profileBackupService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('persists a folder selected through the host dialog', async () => {
        mocks.appOpenFolderSelectorDialog.mockResolvedValue('  D:\\Backups  ');
        mocks.setString.mockResolvedValue(undefined);

        await expect(
            chooseProfileBackupDirectory(' C:\\Current ')
        ).resolves.toBe('D:\\Backups');

        expect(mocks.appOpenFolderSelectorDialog).toHaveBeenCalledWith(
            'C:\\Current'
        );
        expect(mocks.setString).toHaveBeenCalledWith(
            PROFILE_BACKUP_DIRECTORY_CONFIG_KEY,
            'D:\\Backups'
        );
    });

    it('does not overwrite the stored folder when selection is cancelled', async () => {
        mocks.appOpenFolderSelectorDialog.mockResolvedValue('');

        await expect(chooseProfileBackupDirectory('')).resolves.toBeNull();
        expect(mocks.setString).not.toHaveBeenCalled();
    });

    it('prevents status and progress regression from delayed events', () => {
        const current = status({
            jobId: 4,
            state: 'running',
            progress: { stage: 'packaging', completed: 50, total: 100 }
        });
        const delayed = status({
            jobId: 4,
            state: 'running',
            progress: { stage: 'hashing', completed: 100, total: 100 }
        });

        expect(mergeProfileBackupJobStatus(current, delayed).progress).toEqual(
            current.progress
        );
        expect(mergeProfileBackupJobStatus(current, status({ jobId: 3 }))).toBe(
            current
        );
        expect(
            mergeProfileBackupJobStatus(
                status({ jobId: 4, state: 'cancelling' }),
                delayed
            ).state
        ).toBe('cancelling');
    });

    it('calculates bounded phase and overall progress', () => {
        const progress = {
            stage: 'packaging' as const,
            completed: 50,
            total: 100
        };
        expect(profileBackupPhasePercent(progress)).toBe(50);
        expect(profileBackupOverallPercent(progress)).toBe(50);
        expect(profileBackupPhasePercent({ ...progress, completed: 200 })).toBe(
            100
        );
    });

    it('trims the target directory before starting a manual backup', async () => {
        const running = status({ jobId: 1, state: 'running' });
        mocks.appProfileBackupManualStart.mockResolvedValue(running);

        await expect(startManualProfileBackup(' D:\\Backups ')).resolves.toBe(
            running
        );
        expect(mocks.appProfileBackupManualStart).toHaveBeenCalledWith(
            'D:\\Backups'
        );
    });
});
