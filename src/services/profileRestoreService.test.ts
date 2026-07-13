import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    acknowledge: vi.fn(),
    chooseFile: vi.fn(),
    confirm: vi.fn(),
    getState: vi.fn(),
    requestRestore: vi.fn(),
    requestRollback: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appOpenFileSelectorDialog: mocks.chooseFile,
        appProfileRestoreConfirm: mocks.confirm,
        appProfileRestoreRequest: mocks.requestRestore,
        appProfileRestoreResultAcknowledge: mocks.acknowledge,
        appProfileRestoreRollbackRequest: mocks.requestRollback,
        appProfileRestoreStateGet: mocks.getState
    }
}));

import {
    acknowledgeProfileRestoreResult,
    chooseProfileRestoreArchive,
    confirmProfileRestore,
    getProfileRestoreState,
    requestProfileRestore,
    requestProfileRollback
} from './profileRestoreService';

describe('profileRestoreService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the existing file picker with both supported extensions', async () => {
        mocks.chooseFile.mockResolvedValue(' D:\\Backups\\profile.zip ');

        await expect(chooseProfileRestoreArchive()).resolves.toBe(
            'D:\\Backups\\profile.zip'
        );
        expect(mocks.chooseFile).toHaveBeenCalledWith(
            null,
            null,
            'VRCX-0 Backup|*.vrcx0backup;*.zip'
        );
    });

    it('maps a cancelled file selection to null', async () => {
        mocks.chooseFile.mockResolvedValue('');

        await expect(chooseProfileRestoreArchive()).resolves.toBeNull();
    });

    it('delegates restore state and transaction commands', async () => {
        const state = { status: 'idle' };
        const request = { state, restartRequested: false };
        mocks.getState.mockResolvedValue(state);
        mocks.requestRestore.mockResolvedValue(request);
        mocks.confirm.mockResolvedValue(state);
        mocks.requestRollback.mockResolvedValue(request);
        mocks.acknowledge.mockResolvedValue(state);

        await expect(getProfileRestoreState()).resolves.toBe(state);
        await expect(requestProfileRestore('profile.zip')).resolves.toBe(
            request
        );
        await expect(confirmProfileRestore()).resolves.toBe(state);
        await expect(requestProfileRollback()).resolves.toBe(request);
        await expect(acknowledgeProfileRestoreResult()).resolves.toBe(state);
        expect(mocks.requestRestore).toHaveBeenCalledWith('profile.zip');
    });
});
