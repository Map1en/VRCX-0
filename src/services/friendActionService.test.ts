// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    sendRequestInvite: vi.fn(),
    sendBoop: vi.fn(),
    dismissBoops: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    confirm: vi.fn(),
    boopPrompt: vi.fn()
}));

vi.mock('@/services/inviteDeliveryService', () => ({
    sendRequestInviteToUser: mocks.sendRequestInvite,
    sendBoopToUser: mocks.sendBoop
}));

vi.mock('@/services/notificationActionService', () => ({
    dismissBoopNotifications: mocks.dismissBoops
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) =>
            options.type === 'success'
                ? mocks.toastSuccess(options)
                : mocks.toastError(options)
    }
}));

vi.mock('./i18nService', () => ({
    default: { t: (key: string) => key }
}));

import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { boopFriend, requestInviteFromFriend } from './friendActionService';
import {
    configureRecentActionCooldown,
    isActionRecent
} from './recentActionService';

describe('friendActionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore
            .getState()
            .setAuthBootstrap({ currentUserId: 'usr_me' });
        useModalStore.setState({
            confirm: mocks.confirm,
            boopPrompt: mocks.boopPrompt
        });
        configureRecentActionCooldown({ enabled: true, minutes: 60 });
        mocks.confirm.mockResolvedValue({ ok: true });
        mocks.boopPrompt.mockResolvedValue({ ok: true, value: null });
        mocks.sendRequestInvite.mockResolvedValue({});
        mocks.sendBoop.mockResolvedValue({});
        mocks.dismissBoops.mockResolvedValue(undefined);
    });

    it('requests an invite after confirmation and marks it as a recent action', async () => {
        await requestInviteFromFriend({ id: 'usr_friend', label: 'Alice' });

        expect(mocks.confirm).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'common.friend_action.request_invite_title',
                description: 'Alice'
            })
        );
        expect(mocks.sendRequestInvite).toHaveBeenCalledWith({
            receiverUserId: 'usr_friend'
        });
        expect(isActionRecent('usr_friend', 'Request Invite')).toBe(true);
        expect(mocks.toastSuccess).toHaveBeenCalledWith({
            type: 'success',
            title: 'common.friend_action.invite_request_sent'
        });
    });

    it('does not request an invite from yourself or after cancelling', async () => {
        await requestInviteFromFriend({ id: 'usr_me', label: 'Me' });
        expect(mocks.confirm).not.toHaveBeenCalled();

        mocks.confirm.mockResolvedValueOnce({ ok: false });
        await requestInviteFromFriend({ id: 'usr_cancelled', label: 'Alice' });

        expect(mocks.sendRequestInvite).not.toHaveBeenCalled();
        expect(isActionRecent('usr_cancelled', 'Request Invite')).toBe(false);
    });

    it('reports a failed invite request without marking it recent', async () => {
        mocks.sendRequestInvite.mockRejectedValueOnce(
            new Error('Rate limited')
        );

        await requestInviteFromFriend({ id: 'usr_failed', label: 'Alice' });

        expect(mocks.toastError).toHaveBeenCalledWith({
            type: 'error',
            title: 'Rate limited'
        });
        expect(isActionRecent('usr_failed', 'Request Invite')).toBe(false);
    });

    it('dismisses the friend’s boops before sending one back', async () => {
        mocks.boopPrompt.mockResolvedValueOnce({ ok: true, value: 'wave' });

        await boopFriend({ id: 'usr_friend', label: 'Alice' });

        expect(mocks.boopPrompt).toHaveBeenCalledWith({ targetLabel: 'Alice' });
        expect(mocks.dismissBoops).toHaveBeenCalledWith({
            currentUserId: 'usr_me',
            senderUserId: 'usr_friend'
        });
        expect(mocks.sendBoop).toHaveBeenCalledWith({
            userId: 'usr_friend',
            emoji: 'wave'
        });
        expect(mocks.dismissBoops.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.sendBoop.mock.invocationCallOrder[0]
        );
        expect(mocks.toastSuccess).toHaveBeenCalledWith({
            type: 'success',
            title: 'common.friend_action.boop_sent'
        });
    });

    it('does not boop yourself or after the picker is dismissed', async () => {
        await boopFriend({ id: 'usr_me', label: 'Me' });
        expect(mocks.boopPrompt).not.toHaveBeenCalled();

        mocks.boopPrompt.mockResolvedValueOnce({ ok: false });
        await boopFriend({ id: 'usr_friend', label: 'Alice' });

        expect(mocks.dismissBoops).not.toHaveBeenCalled();
        expect(mocks.sendBoop).not.toHaveBeenCalled();
    });

    it('reports a failed boop with the shared fallback copy', async () => {
        mocks.sendBoop.mockRejectedValueOnce('offline');

        await boopFriend({ id: 'usr_friend', label: 'Alice' });

        expect(mocks.toastError).toHaveBeenCalledWith({
            type: 'error',
            title: 'common.friend_action.failed_to_send_boop'
        });
    });
});
