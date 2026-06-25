import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import vrchatFriendRepository from '@/repositories/vrchatFriendRepository';
import vrchatToolsRepository from '@/repositories/vrchatToolsRepository';
import friendRelationshipService from '@/services/friendRelationshipService';
import { sendBoopToUser } from '@/services/inviteDeliveryService';
import {
    acceptFriendRequestNotification,
    dismissBoopNotifications,
    expireNotificationLocally,
    findIncomingFriendRequestNotification,
    hideRemoteAndExpireNotification
} from '@/services/notificationActionService';
import { recordRecentAction } from '@/services/recentActionService';

import { normalizeUserId } from './userProfileFields';
import { useUserInviteActions } from './useUserInviteActions';
import { useUserModerationActions } from './useUserModerationActions';

export function useUserDialogActions({
    actionStatusRef,
    activeUserTargetRef,
    applyFriendPatch,
    avatarOverrideState,
    canInviteFromCurrentLocation,
    confirm,
    currentEndpoint,
    currentInviteLocation,
    currentUserId,
    friendsById,
    isCurrentUser,
    isFriend,
    normalizedCurrentUserId,
    normalizedUserId,
    openGroupQuickModerationDialog,
    moderationRevisionRef,
    moderationState,
    openNonce,
    profile,
    setActionStatus,
    setAvatarOverrideState,
    setBaseProfile,
    setExtendedModerationState,
    setModerationState
}: any) {
    const { t } = useTranslation();
    const [boopDialogRequest, setBoopDialogRequest] = useState<any>(null);

    const {
        handleInviteMessageDialogOpenChange,
        inviteMessageRequest,
        selectInviteMessage,
        sendUserInvite,
        sendUserInviteRequest
    } = useUserInviteActions({
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
    });

    const {
        setAvatarOverrideModeration,
        setExtendedUserModeration,
        setUserModeration
    } = useUserModerationActions({
        actionStatusRef,
        avatarOverrideState,
        confirm,
        currentEndpoint,
        currentUserId,
        isCurrentUser,
        moderationRevisionRef,
        moderationState,
        normalizedCurrentUserId,
        profile,
        setActionStatus,
        setAvatarOverrideState,
        setExtendedModerationState,
        setModerationState
    });

    useLayoutEffect(() => {
        setBoopDialogRequest(null);
    }, [currentEndpoint, normalizedUserId, openNonce, profile?.id]);

    async function unfriendUser() {
        const rosterUserId = normalizeUserId(profile?.id);
        const friend = friendsById[rosterUserId] || profile;
        if (
            !rosterUserId ||
            !isFriend ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'unfriend';
        setActionStatus('unfriend');
        const result = await confirm({
            title: t('dialog.user.modal.unfriend_user'),
            description: friend?.displayName || rosterUserId,
            confirmText: t('dialog.user.actions.unfriend'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const deleteResult = await friendRelationshipService.deleteFriend({
                friend,
                userId: rosterUserId,
                endpoint: currentEndpoint,
                currentUserId
            });
            if (deleteResult.stale) {
                toast.info(
                    t(
                        'dialog.user.action.unfriend_request_sent_but_the_active_session_changed_before_local_state_was_updated'
                    )
                );
            } else {
                setBaseProfile((currentProfile: any) =>
                    currentProfile
                        ? {
                              ...currentProfile,
                              isFriend: false,
                              friendRequestStatus: ''
                          }
                        : currentProfile
                );
                toast.success(
                    t('dialog.user.dynamic.unfriended_value', {
                        value: friend?.displayName || rosterUserId
                    })
                );
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_unfriend_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateFriendRequest(action: any) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }
        const requestEndpoint = currentEndpoint;
        const requestProfile = profile;
        function commitFriendRequestPatch(patch: any) {
            if (
                activeUserTargetRef.current.userId !== rosterUserId ||
                activeUserTargetRef.current.endpoint !== requestEndpoint
            ) {
                return false;
            }
            setBaseProfile((currentProfile: any) =>
                normalizeUserId(currentProfile?.id) === rosterUserId
                    ? { ...currentProfile, ...patch }
                    : currentProfile
            );
            return true;
        }

        const isSendAction = action === 'send' || action === 'accept';
        const label =
            action === 'accept'
                ? t('dialog.user.actions.accept_friend_request')
                : action === 'decline'
                  ? t('dialog.user.actions.decline_friend_request')
                  : action === 'cancel'
                    ? t('dialog.user.actions.cancel_friend_request')
                    : t('dialog.user.actions.send_friend_request');

        actionStatusRef.current = `friend-request:${action}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: t('dialog.user.dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText:
                action === 'accept'
                    ? t('common.actions.accept')
                    : action === 'decline'
                      ? t('common.actions.decline')
                      : action === 'cancel'
                        ? t('dialog.user.actions.cancel_friend_request')
                        : t('dialog.user.actions.send_friend_request'),
            cancelText: t('common.actions.cancel'),
            destructive: action === 'decline' || action === 'cancel'
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        let incomingNotification = null;
        try {
            if (isSendAction) {
                incomingNotification =
                    action === 'accept'
                        ? await findIncomingFriendRequestNotification({
                              currentUserId,
                              targetUserId: rosterUserId
                          })
                        : null;
                if (action === 'accept' && !incomingNotification) {
                    if (
                        !commitFriendRequestPatch({
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        })
                    ) {
                        return;
                    }
                    toast.info(
                        t(
                            'dialog.user.empty.friend_request_is_no_longer_active'
                        )
                    );
                    return;
                }
                let response = null;
                if (action === 'accept') {
                    const acceptResult = await acceptFriendRequestNotification({
                        currentUserId,
                        endpoint: requestEndpoint,
                        notification: incomingNotification,
                        targetUser: requestProfile,
                        stateBucket:
                            requestProfile?.stateBucket ||
                            requestProfile?.state ||
                            'offline'
                    });
                    if (acceptResult.status === 'not-found') {
                        if (
                            !commitFriendRequestPatch({
                                friendRequestStatus: '',
                                incomingRequest: false,
                                outgoingRequest: false
                            })
                        ) {
                            return;
                        }
                        toast.info(
                            t(
                                'dialog.user.empty.friend_request_is_no_longer_active'
                            )
                        );
                        return;
                    }
                } else {
                    response = await vrchatFriendRepository.sendFriendRequest({
                        userId: rosterUserId,
                        endpoint: requestEndpoint
                    });
                }
                const isNowFriend = incomingNotification
                    ? true
                    : Boolean(response?.json?.success);
                if (
                    !commitFriendRequestPatch({
                        isFriend: isNowFriend,
                        friendRequestStatus: isNowFriend ? '' : 'outgoing',
                        incomingRequest: false,
                        outgoingRequest: !isNowFriend
                    })
                ) {
                    return;
                }
                if (isNowFriend) {
                    applyFriendPatch({
                        userId: rosterUserId,
                        patch: {
                            ...requestProfile,
                            id: rosterUserId,
                            isFriend: true,
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        },
                        stateBucket:
                            requestProfile?.stateBucket ||
                            requestProfile?.state ||
                            'offline'
                    });
                }
                if (action === 'send') {
                    recordRecentAction(rosterUserId, 'Send Friend Request');
                }
                toast.success(
                    isNowFriend
                        ? t('dialog.user.toast.friend_request_accepted')
                        : t('dialog.user.toast.friend_request_sent')
                );
            } else {
                incomingNotification =
                    action === 'decline'
                        ? await findIncomingFriendRequestNotification({
                              currentUserId,
                              targetUserId: rosterUserId
                          })
                        : null;
                if (action === 'decline' && !incomingNotification) {
                    if (
                        !commitFriendRequestPatch({
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        })
                    ) {
                        return;
                    }
                    toast.info(
                        t(
                            'dialog.user.empty.friend_request_is_no_longer_active'
                        )
                    );
                    return;
                }
                if (incomingNotification) {
                    await hideRemoteAndExpireNotification({
                        currentUserId,
                        endpoint: requestEndpoint,
                        notification: incomingNotification
                    });
                } else {
                    await vrchatFriendRepository.cancelFriendRequest({
                        userId: rosterUserId,
                        endpoint: requestEndpoint
                    });
                }
                if (
                    !commitFriendRequestPatch({
                        friendRequestStatus: '',
                        incomingRequest: false,
                        outgoingRequest: false
                    })
                ) {
                    return;
                }
                toast.success(
                    action === 'decline'
                        ? t('dialog.user.toast.friend_request_declined')
                        : t('dialog.user.toast.friend_request_cancelled')
                );
            }
        } catch (error) {
            if (
                (action === 'accept' || action === 'decline') &&
                incomingNotification &&
                (error as { status?: number } | null)?.status === 404
            ) {
                await expireNotificationLocally({
                    currentUserId,
                    notification: incomingNotification
                }).catch(() => {});
                if (
                    !commitFriendRequestPatch({
                        friendRequestStatus: '',
                        incomingRequest: false,
                        outgoingRequest: false
                    })
                ) {
                    return;
                }
                toast.info(
                    t('dialog.user.empty.friend_request_is_no_longer_active')
                );
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.value_failed', {
                          value: label
                      })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function reportHacking() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await confirm({
            title: t('dialog.user.modal.report_hacking'),
            description: profile?.displayName || rosterUserId,
            confirmText: t('dialog.user.modal.report'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'report-hacking';
        setActionStatus('report-hacking');
        try {
            await vrchatToolsRepository.reportUser(
                {
                    userId: rosterUserId,
                    contentType: 'user',
                    reason: 'behavior-hacking',
                    type: 'report'
                },
                { endpoint: currentEndpoint }
            );
            toast.success(t('dialog.user.success.report_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_report_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function buildBoopContext() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return null;
        }

        return {
            endpoint: currentEndpoint,
            targetLabel: profile?.displayName || rosterUserId,
            userId: rosterUserId
        };
    }

    function sendUserBoop() {
        const context = buildBoopContext();
        if (context) {
            setBoopDialogRequest(context);
        }
    }

    async function sendUserBoopEmoji(emojiId = '') {
        const context = boopDialogRequest || buildBoopContext();
        if (!context || actionStatusRef.current !== 'idle') {
            return;
        }
        actionStatusRef.current = 'boop';
        setActionStatus('boop');
        try {
            await dismissBoopNotifications({
                currentUserId,
                endpoint: context.endpoint,
                senderUserId: context.userId
            });
            await sendBoopToUser({
                userId: context.userId,
                emojiId,
                endpoint: context.endpoint
            });
            setBoopDialogRequest(null);
            toast.success(t('dialog.user.success.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_send_boop')
            );
            throw error;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function handleBoopDialogOpenChange(nextOpen: any) {
        if (!nextOpen && actionStatusRef.current === 'idle') {
            setBoopDialogRequest(null);
        }
    }

    function openGroupModerationForUser() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        openGroupQuickModerationDialog?.();
    }

    return {
        inviteMessageRequest,
        boopDialogRequest,
        handleBoopDialogOpenChange,
        handleInviteMessageDialogOpenChange,
        selectInviteMessage,
        sendUserBoopEmoji,
        actions: {
            openGroupModerationForUser,
            reportHacking,
            sendUserBoop,
            sendUserInvite,
            sendUserInviteRequest,
            setAvatarOverrideModeration,
            setExtendedUserModeration,
            setUserModeration,
            unfriendUser,
            updateFriendRequest
        }
    };
}
