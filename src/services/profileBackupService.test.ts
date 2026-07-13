import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileBackupJobStatus } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appOpenFolderSelectorDialog: vi.fn(),
    appProfileBackupJobCancel: vi.fn(),
    appProfileBackupManualStart: vi.fn(),
    getBool: vi.fn(),
    getInt: vi.fn(),
    getString: vi.fn(),
    reload: vi.fn(),
    setBool: vi.fn(),
    setInt: vi.fn(),
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
        getBool: mocks.getBool,
        getInt: mocks.getInt,
        getString: mocks.getString,
        reload: mocks.reload,
        setBool: mocks.setBool,
        setInt: mocks.setInt,
        setString: mocks.setString
    }
}));

import {
    chooseProfileBackupDirectory,
    getAutomaticProfileBackupSettings,
    getProfileBackupSettings,
    IDLE_PROFILE_BACKUP_JOB_STATUS,
    mergeProfileBackupJobStatus,
    profileBackupOverallPercent,
    profileBackupPhasePercent,
    PROFILE_BACKUP_DIRECTORY_CONFIG_KEY,
    PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY,
    PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY,
    setAutomaticProfileBackupEnabled,
    setAutomaticProfileBackupIntervalDays,
    setAutomaticProfileBackupRetentionCount,
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
        mocks.getBool.mockResolvedValue(false);
        mocks.getInt.mockResolvedValue(0);
        mocks.getString.mockResolvedValue('');
        mocks.reload.mockResolvedValue(undefined);
        mocks.setBool.mockResolvedValue(undefined);
        mocks.setInt.mockResolvedValue(undefined);
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

    it('loads automatic settings and falls back from out-of-range values', async () => {
        mocks.getBool.mockResolvedValue(true);
        mocks.getInt.mockResolvedValueOnce(31).mockResolvedValueOnce(0);
        mocks.getString.mockResolvedValue(' 2026-07-13T15:30:00Z ');

        await expect(getAutomaticProfileBackupSettings()).resolves.toEqual({
            enabled: true,
            intervalDays: 7,
            retentionCount: 3,
            lastAutomaticAt: '2026-07-13T15:30:00Z'
        });
    });

    it('refreshes cached config before loading the settings view', async () => {
        mocks.getString
            .mockResolvedValueOnce('D:\\Backups')
            .mockResolvedValueOnce('2026-07-13T15:30:00Z');
        mocks.getInt.mockResolvedValueOnce(7).mockResolvedValueOnce(3);

        await expect(getProfileBackupSettings()).resolves.toEqual({
            directory: 'D:\\Backups',
            automatic: {
                enabled: false,
                intervalDays: 7,
                retentionCount: 3,
                lastAutomaticAt: '2026-07-13T15:30:00Z'
            }
        });
        expect(mocks.reload).toHaveBeenCalledOnce();
    });

    it('persists bounded automatic settings and rejects invalid values', async () => {
        await setAutomaticProfileBackupEnabled(true);
        await expect(setAutomaticProfileBackupIntervalDays(14)).resolves.toBe(
            14
        );
        await expect(setAutomaticProfileBackupRetentionCount(5)).resolves.toBe(
            5
        );

        expect(mocks.setBool).toHaveBeenCalledWith(
            'profileBackupAutomaticEnabled',
            true
        );
        expect(mocks.setInt).toHaveBeenCalledWith(
            PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY,
            14
        );
        expect(mocks.setInt).toHaveBeenCalledWith(
            PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY,
            5
        );
        await expect(
            setAutomaticProfileBackupIntervalDays(31)
        ).rejects.toThrow();
        await expect(
            setAutomaticProfileBackupRetentionCount(0)
        ).rejects.toThrow();
    });
});
