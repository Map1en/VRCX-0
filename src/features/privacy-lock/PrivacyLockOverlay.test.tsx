// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrivacyLockOutcome } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    unlock: vi.fn<(password: string) => Promise<PrivacyLockOutcome>>(),
    clear: vi.fn<(password: string) => Promise<PrivacyLockOutcome>>(),
    logout: vi.fn<() => Promise<boolean>>(),
    background: vi.fn<() => Promise<unknown>>()
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appPrivacyLockUnlock: mocks.unlock,
        appPrivacyLockPasswordClear: mocks.clear
    }
}));
vi.mock('@/services/authExecutionService', () => ({
    logoutWithoutConfirmation: mocks.logout
}));
vi.mock('@/services/backgroundModeService', () => ({
    startBackgroundModeForCurrentSession: mocks.background
}));
vi.mock('@/services/entityMediaService', () => ({
    userImage: () => ''
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

import { useRuntimeStore } from '@/state/runtimeStore';

import { PrivacyLockOverlay } from './PrivacyLockOverlay';

function setLockState(locked: boolean, userId = 'usr_1') {
    useRuntimeStore.getState().setPrivacyLock({
        revision: useRuntimeStore.getState().privacyLock.revision + 1,
        userId,
        locked,
        hasPassword: true
    });
}

afterEach(cleanup);
beforeEach(() => {
    vi.resetAllMocks();
    document.elementFromPoint = () => null;
    useRuntimeStore.getState().setAuthBootstrap({ currentUserId: 'usr_1' });
    setLockState(false);
});

describe('PrivacyLockOverlay', () => {
    it('renders nothing while unlocked', () => {
        render(<PrivacyLockOverlay />);
        expect(screen.queryByText('privacy_lock.locked_title')).toBeNull();
    });

    it('covers the app without a form until the snapshot matches the user', () => {
        setLockState(false, 'usr_other');
        render(<PrivacyLockOverlay />);
        expect(
            screen.queryByLabelText('privacy_lock.field.password')
        ).toBeNull();
        expect(
            document.querySelector('[data-vrcx-0-surface="privacy-lock"]')
        ).not.toBeNull();
    });

    it('keeps the lock on a wrong password and lifts it on success', async () => {
        setLockState(true);
        mocks.unlock
            .mockResolvedValueOnce({ status: 'wrongPassword' })
            .mockResolvedValueOnce({
                status: 'ok',
                snapshot: {
                    revision: 10,
                    userId: 'usr_1',
                    locked: false,
                    hasPassword: true
                }
            });
        render(<PrivacyLockOverlay />);

        const input = screen.getByLabelText('privacy_lock.field.password');
        fireEvent.change(input, { target: { value: '0000' } });
        await screen.findByText('privacy_lock.error.wrong_password');
        expect(useRuntimeStore.getState().privacyLock.locked).toBe(true);

        fireEvent.change(input, { target: { value: '1234' } });
        await waitFor(() => {
            expect(useRuntimeStore.getState().privacyLock.locked).toBe(false);
        });
        expect(mocks.unlock).toHaveBeenLastCalledWith('1234');
    });

    it('does not let keyboard events escape to global shortcuts', () => {
        setLockState(true);
        const listener = vi.fn();
        window.addEventListener('keydown', listener);
        render(<PrivacyLockOverlay />);
        fireEvent.keyDown(
            screen.getByLabelText('privacy_lock.field.password'),
            {
                key: 'k',
                ctrlKey: true
            }
        );
        window.removeEventListener('keydown', listener);
        expect(listener).not.toHaveBeenCalled();
    });
});
