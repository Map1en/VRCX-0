// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getState: vi.fn(),
    clear: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastDismiss: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('sonner', () => ({
    toast: {
        success: mocks.toastSuccess,
        error: mocks.toastError,
        dismiss: mocks.toastDismiss
    }
}));

vi.mock('@/services/profileBackupService', () => ({
    getProfileRestoreRollbackState: mocks.getState,
    clearProfileRestoreRollback: mocks.clear
}));

import { useModalStore } from '@/state/modalStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';

import {
    PROFILE_RESTORE_ROLLBACK_TOAST_ID,
    useProfileRestoreRollback
} from './useProfileRestoreRollback';

describe('useProfileRestoreRollback', () => {
    beforeEach(() => {
        mocks.getState.mockReset();
        mocks.clear.mockReset();
        mocks.toastSuccess.mockReset();
        mocks.toastError.mockReset();
        mocks.toastDismiss.mockReset();
        useModalStore.getState().resetModalState();
        useProfileBackupStore.getState().resetProfileBackupState();
        useProfileBackupStore.getState().setRestoreRollbackState({
            count: 1,
            cleanupAllowed: true
        });
    });

    it('hides stale state while refreshing and keeps failures hidden', async () => {
        mocks.getState.mockRejectedValue(new Error('unavailable'));
        const { result } = renderHook(() => useProfileRestoreRollback());

        let refreshed: Awaited<
            ReturnType<typeof result.current.refreshRollbackState>
        >;
        await act(async () => {
            refreshed = await result.current.refreshRollbackState();
        });

        expect(refreshed!).toBeNull();
        expect(
            useProfileBackupStore.getState().restoreRollbackState
        ).toBeNull();
    });

    it('does not restore stale query data after cleanup updates the store', async () => {
        let resolveState: (state: {
            count: number;
            cleanupAllowed: boolean;
        }) => void = () => undefined;
        mocks.getState.mockReturnValue(
            new Promise((resolve) => {
                resolveState = resolve;
            })
        );
        const { result } = renderHook(() => useProfileRestoreRollback());
        let refresh: Promise<{ count: number; cleanupAllowed: boolean } | null>;

        act(() => {
            refresh = result.current.refreshRollbackState();
        });
        act(() => {
            useProfileBackupStore.getState().setRestoreRollbackState({
                count: 0,
                cleanupAllowed: false
            });
            resolveState({ count: 1, cleanupAllowed: true });
        });

        await expect(refresh!).resolves.toEqual({
            count: 0,
            cleanupAllowed: false
        });
        expect(useProfileBackupStore.getState().restoreRollbackState).toEqual({
            count: 0,
            cleanupAllowed: false
        });
    });

    it('does not clear or dismiss the reminder when confirmation is cancelled', async () => {
        const { result } = renderHook(() => useProfileRestoreRollback());
        let cleanup: Promise<void>;

        act(() => {
            cleanup = result.current.confirmAndClearRollback();
        });
        expect(useModalStore.getState().alertDialog.destructive).toBe(true);
        act(() => {
            useModalStore.getState().handleCancel();
        });
        await act(async () => {
            await cleanup!;
        });

        expect(mocks.clear).not.toHaveBeenCalled();
        expect(mocks.toastDismiss).not.toHaveBeenCalled();
        expect(useProfileBackupStore.getState().restoreRollbackState).toEqual({
            count: 1,
            cleanupAllowed: true
        });
    });

    it('updates shared state and dismisses the reminder after cleanup succeeds', async () => {
        mocks.clear.mockResolvedValue({
            accepted: true,
            state: { count: 0, cleanupAllowed: false },
            error: null
        });
        const { result } = renderHook(() => useProfileRestoreRollback());
        let cleanup: Promise<void>;

        act(() => {
            cleanup = result.current.confirmAndClearRollback();
        });
        act(() => {
            useModalStore.getState().handleOk();
        });
        await act(async () => {
            await cleanup!;
        });

        expect(useProfileBackupStore.getState().restoreRollbackState).toEqual({
            count: 0,
            cleanupAllowed: false
        });
        expect(mocks.toastDismiss).toHaveBeenCalledWith(
            PROFILE_RESTORE_ROLLBACK_TOAST_ID
        );
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            'profile_backup.rollback_cleanup_succeeded'
        );
    });

    it('keeps the backend state and reports a typed error when cleanup fails', async () => {
        mocks.clear.mockResolvedValue({
            accepted: false,
            state: { count: 1, cleanupAllowed: true },
            error: { code: 'io', path: 'rollback' }
        });
        const { result } = renderHook(() => useProfileRestoreRollback());
        let cleanup: Promise<void>;

        act(() => {
            cleanup = result.current.confirmAndClearRollback();
        });
        act(() => {
            useModalStore.getState().handleOk();
        });
        await act(async () => {
            await cleanup!;
        });

        expect(useProfileBackupStore.getState().restoreRollbackState).toEqual({
            count: 1,
            cleanupAllowed: true
        });
        expect(mocks.toastDismiss).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith(
            'profile_backup.rollback_error.io'
        );
    });
});
