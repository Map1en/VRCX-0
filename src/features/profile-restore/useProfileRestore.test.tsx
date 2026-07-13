// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileRestoreState } from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import {
    IDLE_PROFILE_RESTORE_STATE,
    useProfileRestoreStore
} from '@/state/profileRestoreStore';

const mocks = vi.hoisted(() => ({
    acknowledge: vi.fn(),
    chooseArchive: vi.fn(),
    confirmProfile: vi.fn(),
    confirmDialog: vi.fn(),
    getState: vi.fn(),
    requestRestore: vi.fn(),
    requestRollback: vi.fn(),
    toastError: vi.fn(),
    toastWarning: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('sonner', () => ({
    toast: {
        error: mocks.toastError,
        warning: mocks.toastWarning
    }
}));

vi.mock('@/services/profileRestoreService', () => ({
    acknowledgeProfileRestoreResult: mocks.acknowledge,
    chooseProfileRestoreArchive: mocks.chooseArchive,
    confirmProfileRestore: mocks.confirmProfile,
    getProfileRestoreState: mocks.getState,
    requestProfileRestore: mocks.requestRestore,
    requestProfileRollback: mocks.requestRollback
}));

import { useProfileRestore } from './useProfileRestore';

function restoreState(
    overrides: Partial<ProfileRestoreState> = {}
): ProfileRestoreState {
    return {
        ...IDLE_PROFILE_RESTORE_STATE,
        ...overrides
    };
}

describe('useProfileRestore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useProfileRestoreStore.getState().reset();
        useModalStore.getState().resetModalState();
        useModalStore.setState({ confirm: mocks.confirmDialog });
        mocks.getState.mockResolvedValue(restoreState());
        mocks.confirmDialog.mockResolvedValue({
            ok: true,
            reason: 'confirm'
        });
    });

    it('loads the persisted restore state once mounted', async () => {
        const pending = restoreState({
            status: 'pendingRestore',
            requiresRestart: true
        });
        mocks.getState.mockResolvedValue(pending);

        const { result } = renderHook(() => useProfileRestore());

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.state).toEqual(pending);
    });

    it('stops when file selection is cancelled', async () => {
        mocks.chooseArchive.mockResolvedValue(null);
        const { result } = renderHook(() => useProfileRestore());
        await waitFor(() => expect(result.current.loaded).toBe(true));

        await act(async () => {
            await result.current.startRestore();
        });

        expect(mocks.confirmDialog).not.toHaveBeenCalled();
        expect(mocks.requestRestore).not.toHaveBeenCalled();
    });

    it('requires risk confirmation before staging the selected archive', async () => {
        mocks.chooseArchive.mockResolvedValue('D:\\Backups\\profile.zip');
        mocks.confirmDialog.mockResolvedValue({
            ok: false,
            reason: 'cancel'
        });
        const { result } = renderHook(() => useProfileRestore());
        await waitFor(() => expect(result.current.loaded).toBe(true));

        await act(async () => {
            await result.current.startRestore();
        });

        expect(mocks.confirmDialog).toHaveBeenCalledWith(
            expect.objectContaining({ destructive: true })
        );
        expect(mocks.requestRestore).not.toHaveBeenCalled();
    });

    it('applies pending state and warns when debug mode needs manual restart', async () => {
        const pending = restoreState({
            status: 'pendingRestore',
            requiresRestart: true
        });
        mocks.chooseArchive.mockResolvedValue('D:\\Backups\\profile.zip');
        mocks.requestRestore.mockResolvedValue({
            state: pending,
            restartRequested: false
        });
        const { result } = renderHook(() => useProfileRestore());
        await waitFor(() => expect(result.current.loaded).toBe(true));

        await act(async () => {
            await result.current.startRestore();
        });

        expect(mocks.requestRestore).toHaveBeenCalledWith(
            'D:\\Backups\\profile.zip'
        );
        expect(result.current.state).toEqual(pending);
        expect(mocks.toastWarning).toHaveBeenCalledWith(
            'view.settings.general.profile_backup.restore_restart_manually'
        );
    });

    it('confirms rollback before requesting it and merges the result', async () => {
        const awaiting = restoreState({
            status: 'restoredAwaitingConfirmation',
            canConfirm: true,
            canRollback: true
        });
        const pending = restoreState({
            status: 'pendingRollback',
            requiresRestart: true
        });
        useProfileRestoreStore.getState().applyState(awaiting);
        mocks.requestRollback.mockResolvedValue({
            state: pending,
            restartRequested: true
        });
        const { result } = renderHook(() => useProfileRestore());

        await act(async () => {
            await result.current.rollback();
        });

        expect(mocks.confirmDialog).toHaveBeenCalledWith(
            expect.objectContaining({ destructive: true })
        );
        expect(mocks.requestRollback).toHaveBeenCalledOnce();
        expect(result.current.state).toEqual(pending);
        expect(mocks.toastWarning).not.toHaveBeenCalled();
    });
});
