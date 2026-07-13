// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileBackupJobStatus } from '@/platform/tauri/bindings';
import { IDLE_PROFILE_BACKUP_JOB_STATUS } from '@/services/profileBackupService';

const mocks = vi.hoisted(() => ({
    cancelProfileBackupJob: vi.fn(),
    chooseProfileBackupDirectory: vi.fn(),
    getProfileBackupJobStatus: vi.fn(),
    getProfileBackupSettings: vi.fn(),
    setAutomaticProfileBackupEnabled: vi.fn(),
    setAutomaticProfileBackupIntervalDays: vi.fn(),
    setAutomaticProfileBackupRetentionCount: vi.fn(),
    startManualProfileBackup: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    eventHandler: null as ((status: ProfileBackupJobStatus) => void) | null
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        events: {
            subscribe: mocks.subscribe
        }
    }
}));

vi.mock('@/services/profileBackupService', async (importOriginal) => ({
    ...(await importOriginal<
        typeof import('@/services/profileBackupService')
    >()),
    cancelProfileBackupJob: mocks.cancelProfileBackupJob,
    chooseProfileBackupDirectory: mocks.chooseProfileBackupDirectory,
    getProfileBackupJobStatus: mocks.getProfileBackupJobStatus,
    getProfileBackupSettings: mocks.getProfileBackupSettings,
    setAutomaticProfileBackupEnabled: mocks.setAutomaticProfileBackupEnabled,
    setAutomaticProfileBackupIntervalDays:
        mocks.setAutomaticProfileBackupIntervalDays,
    setAutomaticProfileBackupRetentionCount:
        mocks.setAutomaticProfileBackupRetentionCount,
    startManualProfileBackup: mocks.startManualProfileBackup
}));

import { useProfileBackupSettings } from './useProfileBackupSettings';

function status(
    overrides: Partial<ProfileBackupJobStatus> = {}
): ProfileBackupJobStatus {
    return {
        ...IDLE_PROFILE_BACKUP_JOB_STATUS,
        ...overrides
    };
}

describe('useProfileBackupSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.eventHandler = null;
        mocks.subscribe.mockImplementation(
            async (
                _name: string,
                handler: (payload: ProfileBackupJobStatus) => void
            ) => {
                mocks.eventHandler = handler;
                return mocks.unsubscribe;
            }
        );
        mocks.getProfileBackupSettings.mockResolvedValue({
            directory: 'D:\\Backups',
            automatic: {
                enabled: true,
                intervalDays: 7,
                retentionCount: 3,
                lastAutomaticAt: '2026-07-13T13:00:00Z'
            }
        });
        mocks.getProfileBackupJobStatus.mockResolvedValue(
            status({ jobId: 1, state: 'running' })
        );
        mocks.setAutomaticProfileBackupEnabled.mockResolvedValue(undefined);
        mocks.setAutomaticProfileBackupIntervalDays.mockImplementation(
            async (value: number) => value
        );
        mocks.setAutomaticProfileBackupRetentionCount.mockImplementation(
            async (value: number) => value
        );
    });

    afterEach(() => {
        mocks.eventHandler = null;
    });

    it('hydrates after subscribing, applies events, and unsubscribes', async () => {
        const { result, unmount } = renderHook(() =>
            useProfileBackupSettings()
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.directory).toBe('D:\\Backups');
        expect(result.current.automatic).toEqual({
            enabled: true,
            intervalDays: 7,
            retentionCount: 3,
            lastAutomaticAt: '2026-07-13T13:00:00Z'
        });
        expect(result.current.status.state).toBe('running');

        act(() => {
            mocks.eventHandler?.(
                status({
                    jobId: 1,
                    state: 'completed',
                    finishedAt: '2026-07-13T13:00:00Z'
                })
            );
        });
        expect(result.current.status.state).toBe('completed');

        act(() => {
            mocks.eventHandler?.(
                status({
                    jobId: 2,
                    state: 'completed',
                    kind: 'automatic',
                    result: {
                        path: 'D:\\Backups\\automatic.vrcx0backup',
                        manifest: {
                            formatVersion: 1,
                            createdAt: '2026-07-14T13:00:00Z',
                            appVersion: '2.12.1',
                            backupKind: 'automatic',
                            databaseSchemaVersion: 18,
                            database: {
                                fileName: 'VRCX-0.sqlite3',
                                size: 1,
                                sha256: 'db'
                            },
                            config: {
                                fileName: 'VRCX-0.json',
                                size: 1,
                                sha256: 'config'
                            }
                        }
                    }
                })
            );
        });
        expect(result.current.automatic.lastAutomaticAt).toBe(
            '2026-07-14T13:00:00Z'
        );

        unmount();
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    });

    it('updates the selected directory without starting a backup', async () => {
        mocks.getProfileBackupJobStatus.mockResolvedValue(status());
        mocks.chooseProfileBackupDirectory.mockResolvedValue(
            'E:\\Safe Backups'
        );
        const { result } = renderHook(() => useProfileBackupSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.chooseDirectory();
        });

        expect(result.current.directory).toBe('E:\\Safe Backups');
        expect(mocks.startManualProfileBackup).not.toHaveBeenCalled();
    });

    it('persists automatic backup settings', async () => {
        mocks.getProfileBackupJobStatus.mockResolvedValue(status());
        const { result } = renderHook(() => useProfileBackupSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.setAutomaticEnabled(false);
        });
        await act(async () => {
            await result.current.setAutomaticIntervalDays(14);
        });
        await act(async () => {
            await result.current.setAutomaticRetentionCount(5);
        });

        expect(mocks.setAutomaticProfileBackupEnabled).toHaveBeenCalledWith(
            false
        );
        expect(
            mocks.setAutomaticProfileBackupIntervalDays
        ).toHaveBeenCalledWith(14);
        expect(
            mocks.setAutomaticProfileBackupRetentionCount
        ).toHaveBeenCalledWith(5);
        expect(result.current.automatic).toMatchObject({
            enabled: false,
            intervalDays: 14,
            retentionCount: 5
        });
    });

    it('does not enable automatic backups without a directory', async () => {
        mocks.getProfileBackupSettings.mockResolvedValue({
            directory: '',
            automatic: {
                enabled: false,
                intervalDays: 7,
                retentionCount: 3,
                lastAutomaticAt: ''
            }
        });
        mocks.getProfileBackupJobStatus.mockResolvedValue(status());
        const { result } = renderHook(() => useProfileBackupSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.setAutomaticEnabled(true);
        });

        expect(mocks.setAutomaticProfileBackupEnabled).not.toHaveBeenCalled();
        expect(result.current.error).toBeInstanceOf(Error);
    });
});
