// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

import type { NotificationRow } from './notificationPageTypes';

const mocks = vi.hoisted(() => ({
    acceptFriendRequest: vi.fn(),
    confirm: vi.fn(),
    deleteNotification: vi.fn(),
    expireLocally: vi.fn(),
    hideRemote: vi.fn(),
    markAllSeen: vi.fn(),
    markSeen: vi.fn(),
    openImagePreview: vi.fn(),
    reload: vi.fn(),
    sendButtonResponse: vi.fn(),
    sendInviteResponse: vi.fn(),
    signalFriendLogChanged: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    toastWarning: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                case 'success':
                    return mocks.toastSuccess(options);
                case 'warning':
                    return mocks.toastWarning(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: (
        selector: (state: {
            confirm: typeof mocks.confirm;
            openImagePreview: typeof mocks.openImagePreview;
        }) => unknown
    ) =>
        selector({
            confirm: mocks.confirm,
            openImagePreview: mocks.openImagePreview
        })
}));

vi.mock('@/state/vrcNotificationStore', () => ({
    useVrcNotificationStore: (
        selector: (state: {
            markAllSeen: typeof mocks.markAllSeen;
            markNotificationSeen: typeof mocks.markSeen;
        }) => unknown
    ) =>
        selector({
            markAllSeen: mocks.markAllSeen,
            markNotificationSeen: mocks.markSeen
        })
}));

vi.mock('@/repositories/notificationPersistenceRepository', () => ({
    default: {
        deleteNotification: mocks.deleteNotification
    }
}));

vi.mock('@/services/friendLogMutationService', () => ({
    signalFriendLogChanged: mocks.signalFriendLogChanged
}));

vi.mock('@/services/notificationActionService', () => ({
    acceptFriendRequestNotification: mocks.acceptFriendRequest,
    acceptRequestInviteNotification: vi.fn(),
    expireNotificationLocally: mocks.expireLocally,
    hideRemoteAndExpireNotification: mocks.hideRemote,
    sendBoopReplyNotification: vi.fn(),
    sendInviteResponseNotification: mocks.sendInviteResponse,
    sendNotificationButtonResponse: mocks.sendButtonResponse
}));

vi.mock('@/services/dialogService', () => ({
    openAvatarDialog: vi.fn(),
    openGroupDialog: vi.fn(),
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('@/services/entityMediaService', () => ({
    convertFileUrlToImageUrl: (value: string) => value,
    openExternalLink: vi.fn()
}));

import { useNotificationActions } from './useNotificationActions';

const notification: NotificationRow = {
    id: 'not_1',
    type: 'friendRequest',
    senderUsername: 'Friend',
    version: 3
};

function renderActions() {
    return renderHook(() =>
        useNotificationActions({
            canInviteFromCurrentLocation: true,
            currentInviteLocation: 'wrld_target:12345',
            currentUserId: 'usr_self',
            notificationTypeLabel: () => 'Friend request',
            reload: mocks.reload,
            setBoopReplyRequest: vi.fn(),
            setInviteResponseRequest: vi.fn()
        })
    );
}

describe('useNotificationActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('leaves a notification untouched when delete confirmation is cancelled', async () => {
        mocks.confirm.mockResolvedValue({ ok: false, reason: 'cancelled' });
        const { result } = renderActions();

        await act(async () => result.current.deleteNotification(notification));

        expect(mocks.deleteNotification).not.toHaveBeenCalled();
        expect(mocks.reload).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('reloads only after a confirmed notification delete succeeds', async () => {
        mocks.confirm.mockResolvedValue({ ok: true, value: undefined });
        mocks.deleteNotification.mockResolvedValue(undefined);
        const { result } = renderActions();

        await act(async () => result.current.deleteNotification(notification));

        expect(mocks.deleteNotification).toHaveBeenCalledWith({
            id: 'not_1',
            userId: 'usr_self'
        });
        expect(
            mocks.deleteNotification.mock.invocationCallOrder[0]
        ).toBeLessThan(mocks.reload.mock.invocationCallOrder[0]);
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'view.notification.success.notification_log_entry_deleted'
            })
        );
    });

    it('ignores an invite locally without touching VRChat', async () => {
        mocks.expireLocally.mockResolvedValue(undefined);
        const invite: NotificationRow = {
            id: 'not_invite',
            type: 'invite',
            senderUserId: 'usr_sender',
            version: 1
        };
        const { result } = renderActions();

        await act(async () => result.current.ignoreNotificationLocally(invite));

        expect(mocks.expireLocally).toHaveBeenCalledWith({
            currentUserId: 'usr_self',
            notification: invite
        });
        expect(mocks.hideRemote).not.toHaveBeenCalled();
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(mocks.expireLocally.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.reload.mock.invocationCallOrder[0]
        );
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'view.notification.success.notification_ignored_locally'
            })
        );
    });

    it('reports partial friend-request success and refreshes friend facts', async () => {
        mocks.confirm.mockResolvedValue({ ok: true, value: undefined });
        mocks.acceptFriendRequest.mockResolvedValue({
            status: 'accepted',
            outcome: { status: 'remoteOkLocalFailed' }
        });
        const { result } = renderActions();

        await act(async () => result.current.acceptFriendRequest(notification));

        expect(mocks.reload).toHaveBeenCalledOnce();
        expect(mocks.signalFriendLogChanged).toHaveBeenCalledOnce();
        expect(mocks.toastWarning).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'warning',
                title: 'dialog.user.toast.applied_on_vrchat_but_local_update_failed'
            })
        );
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('reloads after a failed button response so remote state is reconciled', async () => {
        mocks.sendButtonResponse.mockRejectedValue(new Error('send failed'));
        const { result } = renderActions();

        await act(async () =>
            result.current.sendNotificationResponse(notification, {
                type: 'button',
                label: 'Accept',
                data: 'accept'
            })
        );

        expect(mocks.reload).toHaveBeenCalledOnce();
        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', title: 'send failed' })
        );
    });

    it('reports a sent invite response as sent when the follow-up refresh fails', async () => {
        mocks.sendInviteResponse.mockResolvedValue({ sentPhoto: false });
        mocks.reload.mockRejectedValue(new Error('sync failed'));
        const { result } = renderActions();

        await act(async () =>
            result.current.sendInviteResponseSlot({
                imageData: '',
                notification: { id: 'not_request', type: 'requestInvite' },
                row: { slot: 2 }
            })
        );

        expect(mocks.sendInviteResponse).toHaveBeenCalledWith(
            expect.objectContaining({ responseSlot: 2 })
        );
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'view.notifications.toast.invite_response_sent'
            })
        );
    });
});
