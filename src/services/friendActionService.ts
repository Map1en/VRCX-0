import type { BoopEmojiChoice } from '@/domain/entities/boopEmoji';
import {
    sendBoopToUser,
    sendRequestInviteToUser
} from '@/services/inviteDeliveryService';
import { dismissBoopNotifications } from '@/services/notificationActionService';
import { toast } from '@/services/toastService';
import { normalizeString } from '@/shared/utils/string';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import i18n from './i18nService';
import { recordRecentAction } from './recentActionService';

type FriendActionTarget = {
    id: unknown;
    label: string;
};

function otherUserId(id: unknown): string {
    const userId = normalizeString(id);
    const currentUserId = normalizeString(
        useRuntimeStore.getState().auth.currentUserId
    );
    return userId && userId !== currentUserId ? userId : '';
}

function errorTitle(error: unknown, fallbackKey: string): string {
    return error instanceof Error && error.message
        ? error.message
        : i18n.t(fallbackKey);
}

export async function requestInviteFromFriend({
    id,
    label
}: FriendActionTarget): Promise<void> {
    const friendId = otherUserId(id);
    if (!friendId) {
        return;
    }
    const result = await useModalStore.getState().confirm({
        title: i18n.t('common.friend_action.request_invite_title'),
        description: label || friendId,
        confirmText: i18n.t('common.friend_action.request_invite_confirm'),
        cancelText: i18n.t('common.actions.cancel')
    });
    if (!result.ok) {
        return;
    }
    try {
        await sendRequestInviteToUser({ receiverUserId: friendId });
        recordRecentAction(friendId, 'Request Invite');
        toast.add({
            type: 'success',
            title: i18n.t('common.friend_action.invite_request_sent')
        });
    } catch (error) {
        toast.add({
            type: 'error',
            title: errorTitle(
                error,
                'common.friend_action.failed_to_request_invite'
            )
        });
    }
}

export async function deliverFriendBoop(
    userId: string,
    emoji: BoopEmojiChoice | null
): Promise<void> {
    await dismissBoopNotifications({
        currentUserId: useRuntimeStore.getState().auth.currentUserId || '',
        senderUserId: userId
    });
    await sendBoopToUser({ userId, emoji });
}

export async function boopFriend({
    id,
    label
}: FriendActionTarget): Promise<void> {
    const friendId = otherUserId(id);
    if (!friendId) {
        return;
    }
    try {
        const result = await useModalStore
            .getState()
            .boopPrompt({ targetLabel: label || friendId });
        if (!result.ok) {
            return;
        }
        await deliverFriendBoop(friendId, result.value ?? null);
        toast.add({
            type: 'success',
            title: i18n.t('common.friend_action.boop_sent')
        });
    } catch (error) {
        toast.add({
            type: 'error',
            title: errorTitle(error, 'common.friend_action.failed_to_send_boop')
        });
    }
}
