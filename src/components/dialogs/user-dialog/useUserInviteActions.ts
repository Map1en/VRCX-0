import { useLayoutEffect, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { InviteMessageUsePayload } from '@/components/dialogs/invite-message/InviteMessagePanel';
import {
    sendInviteToLocation,
    sendRequestInviteToUser
} from '@/services/inviteDeliveryService';
import { recordRecentAction } from '@/services/recentActionService';
import { parseLocation } from '@/shared/utils/location';

import { normalizeUserId } from './userProfileFields';

type Confirm = (
    options: Record<string, unknown>
) => Promise<{ ok?: boolean }> | { ok?: boolean };
type BuildInviteContextOptions = {
    requireCurrentUser?: boolean;
};
type UserInviteActionsOptions = {
    actionStatusRef: MutableRefObject<string>;
    canInviteFromCurrentLocation: boolean;
    confirm: Confirm;
    currentEndpoint?: string | null;
    currentInviteLocation?: string | null;
    isCurrentUser: boolean;
    isFriend: boolean;
    normalizedCurrentUserId?: string | null;
    normalizedUserId?: string | null;
    openNonce?: unknown;
    profile?: Record<string, unknown> | null;
    setActionStatus: (status: string) => void;
};
type InviteContext = {
    rosterUserId: string;
    endpoint?: string | null;
    messageOwnerUserId?: string | null;
    parsedLocation: ReturnType<typeof parseLocation>;
    inviteLocation: string;
    targetLabel: string;
};
type InviteRequestContext = {
    rosterUserId: string;
    endpoint?: string | null;
    messageOwnerUserId?: string | null;
    targetLabel: string;
};
type InviteMessageRequest =
    | {
          kind: 'invite';
          messageType: 'message';
          context: InviteContext;
      }
    | {
          kind: 'request';
          messageType: 'request';
          context: InviteRequestContext;
      };
type SendInviteOptions = {
    withMessage?: boolean;
};
type PerformSendInviteOptions = {
    messageSlot?: number | null;
    imageData?: string;
    context?: InviteContext | null;
};
type PerformSendInviteRequestOptions = {
    requestSlot?: number | null;
    imageData?: string;
    context?: InviteRequestContext | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function inviteMessageSlot(row: unknown) {
    const source = isRecord(row) ? row : {};
    const value =
        source.slot ?? source.messageSlot ?? source.requestSlot ?? source.id;
    return Number.parseInt(String(value), 10);
}

export function useUserInviteActions({
    actionStatusRef,
    canInviteFromCurrentLocation,
    confirm,
    currentEndpoint,
    currentInviteLocation,
    isCurrentUser,
    isFriend,
    normalizedCurrentUserId,
    normalizedUserId,
    openNonce,
    profile,
    setActionStatus
}: UserInviteActionsOptions) {
    const { t } = useTranslation();
    const [inviteMessageRequest, setInviteMessageRequest] =
        useState<InviteMessageRequest | null>(null);

    useLayoutEffect(() => {
        setInviteMessageRequest(null);
    }, [
        currentEndpoint,
        normalizedCurrentUserId,
        normalizedUserId,
        openNonce,
        profile?.id
    ]);

    function buildInviteContext({
        requireCurrentUser = false
    }: BuildInviteContextOptions = {}): InviteContext | null {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return null;
        }

        if (requireCurrentUser && !normalizedCurrentUserId) {
            toast.error(
                t(
                    'dialog.user.error.cannot_load_message_templates_no_current_user_session_is_available'
                )
            );
            return null;
        }

        if (!currentInviteLocation) {
            toast.error(
                t(
                    'dialog.user.error.cannot_invite_no_current_vrchat_location_is_available'
                )
            );
            return null;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(
                t(
                    'dialog.user.error.cannot_invite_from_the_current_instance_type'
                )
            );
            return null;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'dialog.user.error.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            );
            return null;
        }

        return {
            rosterUserId,
            endpoint: currentEndpoint,
            messageOwnerUserId: normalizedCurrentUserId,
            parsedLocation,
            inviteLocation: parsedLocation.tag || currentInviteLocation,
            targetLabel: String(profile?.displayName || rosterUserId)
        };
    }

    function buildInviteRequestContext({
        requireCurrentUser = false
    }: BuildInviteContextOptions = {}): InviteRequestContext | null {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return null;
        }

        if (requireCurrentUser && !normalizedCurrentUserId) {
            toast.error(
                t(
                    'dialog.user.error.cannot_load_message_templates_no_current_user_session_is_available'
                )
            );
            return null;
        }

        return {
            rosterUserId,
            endpoint: currentEndpoint,
            messageOwnerUserId: normalizedCurrentUserId,
            targetLabel: String(profile?.displayName || rosterUserId)
        };
    }

    async function performSendUserInvite({
        messageSlot = null,
        imageData = '',
        context: contextSnapshot = null
    }: PerformSendInviteOptions = {}) {
        const context = contextSnapshot || buildInviteContext();
        if (!context) {
            return false;
        }
        if (actionStatusRef.current !== 'idle') {
            return false;
        }

        actionStatusRef.current = 'invite';
        setActionStatus('invite');
        try {
            await sendInviteToLocation({
                receiverUserId: context.rosterUserId,
                instanceId: context.inviteLocation,
                worldId: context.parsedLocation.worldId,
                messageSlot,
                imageData,
                rsvp: true
            });
            recordRecentAction(
                context.rosterUserId,
                messageSlot !== null ? 'Invite Message' : 'Invite'
            );
            toast.success(
                messageSlot !== null
                    ? t('dialog.user.toast.invite_message_sent')
                    : t('message.invite.sent')
            );
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_send_invite')
            );
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserInvite({
        withMessage = false
    }: SendInviteOptions = {}) {
        if (withMessage) {
            const context = buildInviteContext({ requireCurrentUser: true });
            if (context) {
                setInviteMessageRequest({
                    kind: 'invite',
                    messageType: 'message',
                    context
                });
            }
            return;
        }

        const context = buildInviteContext();
        if (!context) {
            return;
        }

        const result = await confirm({
            title: t('dialog.user.modal.send_invite'),
            description: profile?.displayName || context.rosterUserId,
            confirmText: t('dialog.user.actions.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await performSendUserInvite({ context });
    }

    async function performSendUserInviteRequest({
        requestSlot = null,
        imageData = '',
        context: contextSnapshot = null
    }: PerformSendInviteRequestOptions = {}) {
        const context = contextSnapshot || buildInviteRequestContext();
        if (!context) {
            return false;
        }
        if (actionStatusRef.current !== 'idle') {
            return false;
        }

        actionStatusRef.current = 'request-invite';
        setActionStatus('request-invite');
        try {
            await sendRequestInviteToUser({
                receiverUserId: context.rosterUserId,
                requestSlot,
                imageData
            });
            recordRecentAction(
                context.rosterUserId,
                requestSlot !== null
                    ? 'Request Invite Message'
                    : 'Request Invite'
            );
            toast.success(
                requestSlot !== null
                    ? t('dialog.user.toast.invite_request_message_sent')
                    : t('dialog.user.toast.invite_request_sent')
            );
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_request_invite')
            );
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserInviteRequest({
        withMessage = false
    }: SendInviteOptions = {}) {
        if (withMessage) {
            const context = buildInviteRequestContext({
                requireCurrentUser: true
            });
            if (context) {
                setInviteMessageRequest({
                    kind: 'request',
                    messageType: 'request',
                    context
                });
            }
            return;
        }

        const context = buildInviteRequestContext();
        if (!context) {
            return;
        }

        const result = await confirm({
            title: t('dialog.user.modal.request_invite'),
            description: profile?.displayName || context.rosterUserId,
            confirmText: t('dialog.user.actions.request_invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await performSendUserInviteRequest({ context });
    }

    async function selectInviteMessage({
        row,
        imageData = ''
    }: InviteMessageUsePayload) {
        const slot = inviteMessageSlot(row);
        if (!Number.isFinite(slot)) {
            toast.error(
                t('dialog.user.action.invite_message_slot_must_be_a_number')
            );
            return false;
        }

        const request = inviteMessageRequest;
        const sent =
            request?.kind === 'request'
                ? await performSendUserInviteRequest({
                      requestSlot: slot,
                      imageData,
                      context: request.context
                  })
                : await performSendUserInvite({
                      messageSlot: slot,
                      imageData,
                      context:
                          request?.kind === 'invite' ? request.context : null
                  });

        if (sent) {
            setInviteMessageRequest(null);
        }
        return sent;
    }

    const handleInviteMessageDialogOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && actionStatusRef.current === 'idle') {
            setInviteMessageRequest(null);
        }
    };

    return {
        handleInviteMessageDialogOpenChange,
        inviteMessageRequest,
        selectInviteMessage,
        sendUserInvite,
        sendUserInviteRequest
    };
}
