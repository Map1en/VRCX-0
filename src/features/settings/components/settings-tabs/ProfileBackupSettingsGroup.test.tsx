// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProfileBackupJobStatus } from '@/platform/tauri/bindings';
import { IDLE_PROFILE_BACKUP_JOB_STATUS } from '@/services/profileBackupService';

const mocks = vi.hoisted(() => ({
    cancelBackup: vi.fn(),
    chooseDirectory: vi.fn(),
    startManualBackup: vi.fn(),
    useProfileBackupSettings: vi.fn()
}));

const labels: Record<string, string> = {
    'view.settings.general.profile_backup.header': 'Profile Backup',
    'view.settings.general.profile_backup.description': 'Backup profile data',
    'view.settings.general.profile_backup.warning_title':
        'Backups are not encrypted',
    'view.settings.general.profile_backup.warning_description':
        'May contain cookies and API keys',
    'view.settings.general.profile_backup.directory': 'Backup Folder',
    'view.settings.general.profile_backup.directory_description':
        'Choose a backup folder',
    'view.settings.general.profile_backup.directory_empty':
        'No folder selected',
    'view.settings.general.profile_backup.choose_directory': 'Choose Folder…',
    'view.settings.general.profile_backup.manual': 'Manual Backup',
    'view.settings.general.profile_backup.manual_description':
        'Runs in the background',
    'view.settings.general.profile_backup.backup_now': 'Back Up Now',
    'view.settings.general.profile_backup.cancel': 'Cancel',
    'view.settings.general.profile_backup.status_idle': 'Ready',
    'view.settings.general.profile_backup.status_running': 'Preparing backup',
    'view.settings.general.profile_backup.status_cancelling': 'Cancelling…',
    'view.settings.general.profile_backup.status_completed': 'Backup complete',
    'view.settings.general.profile_backup.status_failed': 'Backup failed',
    'view.settings.general.profile_backup.status_cancelled': 'Backup cancelled',
    'view.settings.general.profile_backup.stage_database_snapshot': 'Snapshot',
    'view.settings.general.profile_backup.stage_hashing': 'Hashing',
    'view.settings.general.profile_backup.stage_packaging': 'Packaging',
    'view.settings.general.profile_backup.stage_validating': 'Validating',
    'view.settings.general.profile_backup.stage_publishing': 'Publishing',
    'view.settings.general.profile_backup.action_failed': 'Backup failed'
};

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string) => labels[key] ?? key
    })
}));

vi.mock('../../useProfileBackupSettings', () => ({
    useProfileBackupSettings: mocks.useProfileBackupSettings
}));

import { ProfileBackupSettingsGroup } from './ProfileBackupSettingsGroup';

function status(
    overrides: Partial<ProfileBackupJobStatus> = {}
): ProfileBackupJobStatus {
    return {
        ...IDLE_PROFILE_BACKUP_JOB_STATUS,
        ...overrides
    };
}

function mockModel(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        cancelBackup: mocks.cancelBackup,
        chooseDirectory: mocks.chooseDirectory,
        directory: 'D:\\Backups',
        error: null,
        loading: false,
        pendingAction: null,
        startManualBackup: mocks.startManualBackup,
        status: status(),
        ...overrides
    };
}

describe('ProfileBackupSettingsGroup', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('shows the security warning and runs directory/manual actions', async () => {
        const user = userEvent.setup();
        mocks.useProfileBackupSettings.mockReturnValue(mockModel());
        render(<ProfileBackupSettingsGroup />);

        expect(screen.getByText('Backups are not encrypted')).toBeTruthy();
        expect(
            screen.getByText('May contain cookies and API keys')
        ).toBeTruthy();
        expect(screen.getByText('D:\\Backups')).toBeTruthy();

        await user.click(
            screen.getByRole('button', { name: 'Choose Folder…' })
        );
        await user.click(screen.getByRole('button', { name: 'Back Up Now' }));

        expect(mocks.chooseDirectory).toHaveBeenCalledOnce();
        expect(mocks.startManualBackup).toHaveBeenCalledOnce();
    });

    it('shows progress and cancellation while a backup is running', async () => {
        const user = userEvent.setup();
        mocks.useProfileBackupSettings.mockReturnValue(
            mockModel({
                status: status({
                    jobId: 2,
                    state: 'running',
                    progress: {
                        stage: 'hashing',
                        completed: 1,
                        total: 2
                    }
                })
            })
        );
        render(<ProfileBackupSettingsGroup />);

        expect(screen.getByText('Hashing · 50%')).toBeTruthy();
        expect(screen.getByRole('progressbar')).toBeTruthy();
        expect(
            (
                screen.getByRole('button', {
                    name: 'Choose Folder…'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(mocks.cancelBackup).toHaveBeenCalledOnce();
    });

    it('requires a selected directory before starting', () => {
        mocks.useProfileBackupSettings.mockReturnValue(
            mockModel({ directory: '' })
        );
        render(<ProfileBackupSettingsGroup />);

        expect(screen.getByText('No folder selected')).toBeTruthy();
        expect(
            (
                screen.getByRole('button', {
                    name: 'Back Up Now'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
    });
});
