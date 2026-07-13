// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileBackupJobStatus } from '@/platform/tauri/bindings';
import { IDLE_PROFILE_BACKUP_JOB_STATUS } from '@/services/profileBackupService';

const mocks = vi.hoisted(() => ({
    cancelProfileBackupJob: vi.fn(),
    chooseProfileBackupDirectory: vi.fn(),
    getProfileBackupDirectory: vi.fn(),
    getProfileBackupJobStatus: vi.fn(),
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
    getProfileBackupDirectory: mocks.getProfileBackupDirectory,
    getProfileBackupJobStatus: mocks.getProfileBackupJobStatus,
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
        mocks.getProfileBackupDirectory.mockResolvedValue('D:\\Backups');
        mocks.getProfileBackupJobStatus.mockResolvedValue(
            status({ jobId: 1, state: 'running' })
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
});
