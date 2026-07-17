import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    error: vi.fn(),
    openFile: vi.fn(),
    validate: vi.fn()
}));

vi.mock('sonner', () => ({
    toast: {
        error: mocks.error
    }
}));

vi.mock('@/services/i18nService', () => ({
    default: {
        t: (key: string) => key
    }
}));

vi.mock('@/services/profileBackupService', () => ({
    validateProfileRestore: mocks.validate
}));

vi.mock('@/services/shellIntegrationService', () => ({
    openFileSelectorDialog: mocks.openFile
}));

import { useProfileBackupStore } from '@/state/profileBackupStore';

import { selectProfileBackupToRestore } from './profileRestoreSelectionService';

describe('selectProfileBackupToRestore', () => {
    beforeEach(() => {
        mocks.error.mockClear();
        mocks.openFile.mockReset();
        mocks.validate.mockReset();
        useProfileBackupStore.getState().resetProfileBackupState();
    });

    it('selects, validates, and opens the shared restore confirmation', async () => {
        mocks.openFile.mockResolvedValue('E:\\Backups\\profile.vrcx0backup');
        mocks.validate.mockResolvedValue({
            failure: null,
            validation: {
                appVersion: 'compatible',
                archive: 'valid',
                database: 'valid',
                databaseVersion: 'compatible',
                manifest: {
                    appVersion: '1.2.3',
                    createdAt: '2026-07-15T00:00:00Z',
                    dbVersion: 18,
                    kind: 'manual',
                    platform: 'windows'
                },
                sourceFileName: 'profile.vrcx0backup',
                stagedBytes: 1024,
                stagedSha256: 'abc123'
            }
        });

        await expect(selectProfileBackupToRestore('E:\\Backups')).resolves.toBe(
            true
        );

        expect(mocks.openFile).toHaveBeenCalledWith(
            'E:\\Backups',
            '.vrcx0backup',
            'profile_backup.file_filter (*.vrcx0backup)|*.vrcx0backup'
        );
        expect(mocks.validate).toHaveBeenCalledWith(
            'E:\\Backups\\profile.vrcx0backup'
        );
        expect(useProfileBackupStore.getState().restoreFlow).toBe('confirm');
        expect(
            useProfileBackupStore.getState().restoreValidation?.sourceFileName
        ).toBe('profile.vrcx0backup');
    });

    it('keeps the confirmation closed when validation fails', async () => {
        mocks.openFile.mockResolvedValue('E:\\Backups\\broken.vrcx0backup');
        mocks.validate.mockResolvedValue({
            failure: { code: 'invalidArchive', path: null },
            validation: null
        });

        await expect(selectProfileBackupToRestore()).resolves.toBe(false);

        expect(useProfileBackupStore.getState().restoreFlow).toBe('idle');
        expect(mocks.error).toHaveBeenCalledWith(
            'profile_backup.error.invalid_archive'
        );
    });

    it('allows another selection after the file picker fails', async () => {
        mocks.openFile
            .mockRejectedValueOnce(new Error('picker failed'))
            .mockResolvedValueOnce('');

        await expect(selectProfileBackupToRestore()).resolves.toBe(false);
        await expect(selectProfileBackupToRestore()).resolves.toBe(false);

        expect(mocks.openFile).toHaveBeenCalledTimes(2);
        expect(mocks.error).toHaveBeenCalledWith(
            'profile_backup.file_selection_failed'
        );
    });
});
