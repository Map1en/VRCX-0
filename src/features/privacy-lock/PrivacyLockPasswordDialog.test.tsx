// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PrivacyLockDeviceStart,
    PrivacyLockOutcome,
    SavedAuthSnapshot
} from '@/platform/tauri/bindings';
import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    passwordSet: vi.fn<(password: string) => Promise<PrivacyLockOutcome>>(),
    passwordClear: vi.fn<(password: string) => Promise<PrivacyLockOutcome>>(),
    verifyStart: vi.fn<() => Promise<PrivacyLockDeviceStart>>(),
    verifyWait: vi.fn<(attemptId: string) => Promise<PrivacyLockOutcome>>(),
    verifyCancel: vi.fn<() => Promise<null>>(),
    cachedSnapshot: vi.fn<() => SavedAuthSnapshot | null>(),
    toastSuccess: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appPrivacyLockPasswordSet: mocks.passwordSet,
        appPrivacyLockPasswordClear: mocks.passwordClear,
        appPrivacyLockDeviceVerifyStart: mocks.verifyStart,
        appPrivacyLockDeviceVerifyWait: mocks.verifyWait,
        appPrivacyLockDeviceVerifyCancel: mocks.verifyCancel
    }
}));

vi.mock('@/services/authSnapshotService', () => ({
    getCachedAuthSnapshot: mocks.cachedSnapshot
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            if (options.type === 'success') {
                return mocks.toastSuccess(options);
            }
            throw new Error('Unhandled toast type: ' + options.type);
        }
    }
}));

vi.mock('@/components/device-login/DeviceLoginQr', () => ({
    DeviceLoginQrCode: ({ value }: { value: string }) => (
        <div data-testid="qr-code">{value}</div>
    ),
    DeviceLoginWaitingStatus: () => null
}));

import { useRuntimeStore } from '@/state/runtimeStore';

import { PrivacyLockPasswordDialog } from './PrivacyLockPasswordDialog';

function snapshotFor(
    hasLoginCredentials: boolean,
    hasPassword: boolean
): SavedAuthSnapshot {
    return {
        lastUserLoggedIn: 'usr_1',
        autoLoginStatus: 'available',
        autoLoginReason: '',
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        savedCredentialsList: [
            {
                user: { id: 'usr_1' },
                loginParams: { username: hasLoginCredentials ? 'me' : '' },
                hasLoginCredentials,
                hasCookies: !hasLoginCredentials || hasPassword
            }
        ]
    };
}

function setLockState({
    locked = false,
    hasPassword = true
}: { locked?: boolean; hasPassword?: boolean } = {}) {
    useRuntimeStore.getState().setPrivacyLock({
        revision: useRuntimeStore.getState().privacyLock.revision + 1,
        userId: 'usr_1',
        locked,
        hasPassword
    });
}

function okOutcome(hasPassword: boolean): PrivacyLockOutcome {
    return {
        status: 'ok',
        snapshot: {
            revision: useRuntimeStore.getState().privacyLock.revision + 1,
            userId: 'usr_1',
            locked: false,
            hasPassword
        }
    };
}

function openClearView(onClose = vi.fn()) {
    render(
        <PrivacyLockPasswordDialog
            open
            engageAfterSetup={false}
            onClose={onClose}
        />
    );
    fireEvent.click(
        screen.getByRole('button', { name: 'privacy_lock.action.clear_link' })
    );
    return onClose;
}

afterEach(cleanup);
beforeEach(() => {
    vi.resetAllMocks();
    document.elementFromPoint = () => null;
    useRuntimeStore.getState().resetRuntimeState();
    useRuntimeStore.getState().setAuthBootstrap({ currentUserId: 'usr_1' });
    mocks.verifyCancel.mockResolvedValue(null);
    mocks.cachedSnapshot.mockReturnValue(snapshotFor(true, true));
});

describe('PrivacyLockPasswordDialog', () => {
    it('only sets a lock password of exactly four matching digits', async () => {
        setLockState({ hasPassword: false });
        mocks.passwordSet.mockResolvedValue(okOutcome(true));
        render(
            <PrivacyLockPasswordDialog
                open
                engageAfterSetup={false}
                onClose={vi.fn()}
            />
        );
        const newPassword = screen.getByLabelText(
            'privacy_lock.field.new_password'
        );
        const confirmPassword = screen.getByLabelText(
            'privacy_lock.field.confirm_password'
        );
        const submit = screen.getByRole('button', {
            name: 'privacy_lock.action.set'
        });

        fireEvent.change(newPassword, { target: { value: '123' } });
        fireEvent.change(confirmPassword, { target: { value: '123' } });
        fireEvent.click(submit);
        expect(mocks.passwordSet).not.toHaveBeenCalled();

        fireEvent.change(newPassword, { target: { value: '1234' } });
        fireEvent.change(confirmPassword, { target: { value: '1234' } });
        fireEvent.click(submit);
        await waitFor(() =>
            expect(mocks.passwordSet).toHaveBeenCalledWith('1234')
        );
    });

    it('removes the lock password of a QR-only account by QR verification', async () => {
        setLockState();
        mocks.cachedSnapshot.mockReturnValue(snapshotFor(false, true));
        mocks.verifyStart.mockResolvedValue({
            status: 'pending',
            attemptId: '7',
            verificationUrl: 'https://vrchat.com/device?code=ABCD',
            expiresAt: Date.now() + 60_000
        });
        mocks.verifyWait.mockResolvedValue(okOutcome(false));

        const onClose = openClearView();

        await waitFor(() => expect(mocks.verifyWait).toHaveBeenCalledWith('7'));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'privacy_lock.toast.cleared' })
        );
        expect(mocks.passwordClear).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().privacyLock.hasPassword).toBe(false);
    });

    it('stops its QR verification once the app locks so the lock screen can start its own', async () => {
        setLockState();
        mocks.cachedSnapshot.mockReturnValue(snapshotFor(false, true));
        mocks.verifyStart.mockResolvedValue({
            status: 'pending',
            attemptId: '7',
            verificationUrl: 'https://vrchat.com/device?code=ABCD',
            expiresAt: Date.now() + 60_000
        });
        mocks.verifyWait.mockReturnValue(new Promise(() => {}));

        openClearView();
        await waitFor(() => expect(mocks.verifyWait).toHaveBeenCalled());
        expect(mocks.verifyCancel).not.toHaveBeenCalled();

        setLockState({ locked: true });

        await waitFor(() => expect(mocks.verifyCancel).toHaveBeenCalled());
    });
});
