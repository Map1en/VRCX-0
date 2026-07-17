// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SavedAuthSnapshot } from '@/repositories/authRepository';

const mocks = vi.hoisted(() => ({
    executeAutoLogin: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('sonner', () => ({
    toast: { error: mocks.toastError }
}));

vi.mock('@/services/authAutoLoginService', () => ({
    executeReactAutoLogin: mocks.executeAutoLogin
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: {
            shell: { backendRuntimeSnapshotHydrated: boolean };
        }) => unknown
    ) => selector({ shell: { backendRuntimeSnapshotHydrated: true } })
}));

import { useLoginAutoLogin } from './useLoginAutoLogin';

const snapshot: SavedAuthSnapshot = {
    autoLoginDelayEnabled: false,
    autoLoginDelaySeconds: 0,
    autoLoginReason: '',
    autoLoginStatus: 'available',
    lastUserLoggedIn: 'usr_1',
    savedCredentialCount: 1,
    savedCredentials: {
        usr_1: {
            hasLoginCredentials: true,
            loginParams: { username: 'account' },
            user: { id: 'usr_1' }
        }
    }
};

describe('useLoginAutoLogin', () => {
    beforeEach(() => {
        mocks.executeAutoLogin.mockReset();
        mocks.toastError.mockReset();
    });

    it('applies the snapshot returned by automatic login', async () => {
        const nextSnapshot = { ...snapshot, autoLoginStatus: 'completed' };
        const applySnapshot = vi.fn((_value: SavedAuthSnapshot) => undefined);
        mocks.executeAutoLogin.mockResolvedValue({
            snapshot: nextSnapshot,
            status: 'success'
        });

        renderHook(() =>
            useLoginAutoLogin({
                activeSavedUserId: '',
                applySnapshot,
                databaseReady: true,
                isLoading: false,
                isSubmitting: false,
                snapshot
            })
        );

        await waitFor(() => {
            expect(applySnapshot).toHaveBeenCalledWith(nextSnapshot);
        });
    });

    it('aborts the active automatic login when manual interaction starts', async () => {
        mocks.executeAutoLogin.mockImplementation(
            (
                _snapshot: SavedAuthSnapshot,
                { signal }: { signal: AbortSignal }
            ) =>
                new Promise((resolve) => {
                    signal.addEventListener('abort', () => {
                        resolve({ snapshot, status: 'cancelled' });
                    });
                })
        );
        const applySnapshot = vi.fn((_value: SavedAuthSnapshot) => undefined);
        const { result } = renderHook(() =>
            useLoginAutoLogin({
                activeSavedUserId: '',
                applySnapshot,
                databaseReady: true,
                isLoading: false,
                isSubmitting: false,
                snapshot
            })
        );

        await waitFor(() => {
            expect(mocks.executeAutoLogin).toHaveBeenCalledTimes(1);
        });
        act(() => {
            result.current.cancelPendingAutoLogin();
        });

        expect(mocks.executeAutoLogin.mock.calls[0]?.[1]).toMatchObject({
            signal: { aborted: true }
        });
    });
});
