import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    sendInviteToLocation,
    sendRequestInviteToUser
} from '@/services/inviteDeliveryService';
import { recordRecentAction } from '@/services/recentActionService';
import { parseLocation } from '@/shared/utils/locationParser';

import { normalizeUserId } from './userProfileFields';

function inviteMessageSlot(row: any) {
    const value = row?.slot ?? row?.messageSlot ?? row?.requestSlot ?? row?.id;
    return Number.parseInt(value, 10);
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
}: any) {
    const { t } = useTranslation();
    const [inviteMessageRequest, setInviteMessageRequest] = useState<{
        kind: string;
        messageType: string;
        context: any;
    } | null>(null);

    useLayoutEffect(() => {
        setInviteMessageRequest(null);
    }, [
        currentEndpoint,
        normalizedCurrentUserId,
        normalizedUserId,
        openNonce,
        profile?.id
    ]);

    function buildInviteContext({ requireCurrentUser = false }: any = {}) {
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
            targetLabel: profile?.displayName || rosterUserId
        };
    }

    function buildInviteRequestContext({
        requireCurrentUser = false
    }: any = {}) {
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
            targetLabel: profile?.displayName || rosterUserId
        };
    }

    async function performSendUserInvite({
        messageSlot = null,
        imageData = '',
        context: contextSnapshot = null
    }: any = {}) {
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
                endpoint: context.endpoint,
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

    async function sendUserInvite({ withMessage = false }: any = {}) {
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
    }: any = {}) {
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
                endpoint: context.endpoint,
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

    async function sendUserInviteRequest({ withMessage = false }: any = {}) {
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

    async function selectInviteMessage({ row, imageData = '' }: any) {
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
                      context: request?.context
                  });

        if (sent) {
            setInviteMessageRequest(null);
        }
        return sent;
    }

    const handleInviteMessageDialogOpenChange = (nextOpen: any) => {
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
