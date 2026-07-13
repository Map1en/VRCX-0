// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProfileBackupJobStatus } from '@/platform/tauri/bindings';
import { IDLE_PROFILE_BACKUP_JOB_STATUS } from '@/services/profileBackupService';

const mocks = vi.hoisted(() => ({
    cancelBackup: vi.fn(),
    chooseDirectory: vi.fn(),
    setAutomaticEnabled: vi.fn(),
    setAutomaticIntervalDays: vi.fn(),
    setAutomaticRetentionCount: vi.fn(),
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
    'view.settings.general.profile_backup.automatic_enabled':
        'Automatic Backup',
    'view.settings.general.profile_backup.automatic_enabled_description':
        'Runs on a schedule',
    'view.settings.general.profile_backup.automatic_interval':
        'Backup Interval',
    'view.settings.general.profile_backup.automatic_interval_description':
        'Every 1 to 30 days',
    'view.settings.general.profile_backup.automatic_interval_unit': 'days',
    'view.settings.general.profile_backup.automatic_retention':
        'Automatic Backups to Keep',
    'view.settings.general.profile_backup.automatic_retention_description':
        'Keeps automatic backups only',
    'view.settings.general.profile_backup.automatic_retention_unit': 'files',
    'view.settings.general.profile_backup.last_automatic':
        'Last Automatic Backup',
    'view.settings.general.profile_backup.last_automatic_description':
        'Last successful completion',
    'view.settings.general.profile_backup.last_automatic_never': 'Never',
    'view.settings.general.profile_backup.kind_manual': 'Manual',
    'view.settings.general.profile_backup.kind_automatic': 'Automatic',
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
        automatic: {
            enabled: false,
            intervalDays: 7,
            retentionCount: 3,
            lastAutomaticAt: ''
        },
        cancelBackup: mocks.cancelBackup,
        chooseDirectory: mocks.chooseDirectory,
        directory: 'D:\\Backups',
        error: null,
        loading: false,
        pendingAction: null,
        setAutomaticEnabled: mocks.setAutomaticEnabled,
        setAutomaticIntervalDays: mocks.setAutomaticIntervalDays,
        setAutomaticRetentionCount: mocks.setAutomaticRetentionCount,
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
        await user.click(
            screen.getByRole('switch', { name: 'Automatic Backup' })
        );

        expect(mocks.chooseDirectory).toHaveBeenCalledOnce();
        expect(mocks.startManualBackup).toHaveBeenCalledOnce();
        expect(mocks.setAutomaticEnabled).toHaveBeenCalledWith(true);
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

    it('edits automatic backup settings and shows the automatic job kind', async () => {
        const user = userEvent.setup();
        mocks.useProfileBackupSettings.mockReturnValue(
            mockModel({
                automatic: {
                    enabled: true,
                    intervalDays: 7,
                    retentionCount: 3,
                    lastAutomaticAt: '2026-07-13T13:00:00Z'
                },
                status: status({
                    jobId: 3,
                    state: 'running',
                    kind: 'automatic'
                })
            })
        );
        render(<ProfileBackupSettingsGroup />);

        expect(screen.getByText('Automatic · Preparing backup')).toBeTruthy();
        expect(screen.getByTitle('2026-07-13T13:00:00Z')).toBeTruthy();

        const interval = screen.getByRole('spinbutton', {
            name: 'Backup Interval'
        });
        await user.clear(interval);
        await user.type(interval, '14');
        await user.tab();

        const retention = screen.getByRole('spinbutton', {
            name: 'Automatic Backups to Keep'
        });
        await user.clear(retention);
        await user.type(retention, '5');
        await user.tab();

        expect(mocks.setAutomaticIntervalDays).toHaveBeenCalledWith(14);
        expect(mocks.setAutomaticRetentionCount).toHaveBeenCalledWith(5);
    });
});
