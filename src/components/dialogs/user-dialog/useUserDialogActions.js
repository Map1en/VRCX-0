import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    notificationRepository,
    toolsRepository,
    vrchatFriendRepository
} from '@/repositories/index.js';
import { openGroupDialog } from '@/services/dialogService.js';
import friendRelationshipService from '@/services/friendRelationshipService.js';
import { recordRecentAction } from '@/services/recentActionService.js';

import { normalizeUserId } from './userProfileFields.js';
import { useUserInviteActions } from './useUserInviteActions.js';
import { useUserModerationActions } from './useUserModerationActions.js';

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
    moderationRevisionRef,
    moderationState,
    openNonce,
    profile,
    prompt,
    setActionStatus,
    setAvatarOverrideState,
    setBaseProfile,
    setExtendedModerationState,
    setModerationState,
    userSessionRepository
}) {
    const { t } = useTranslation();

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
        setModerationState,
        userSessionRepository
    });

    async function findIncomingFriendRequestNotification(rosterUserId) {
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        if (!normalizedCurrentUserId || !rosterUserId) {
            return null;
        }

        const rows = await notificationRepository.queryNotifications({
            userId: normalizedCurrentUserId,
            filters: ['friendRequest']
        });
        return (
            rows.find(
                (row) =>
                    row?.type === 'friendRequest' &&
                    !row.expired &&
                    normalizeUserId(row.senderUserId) === rosterUserId
            ) || null
        );
    }

    async function dismissBoopNotifications(rosterUserId) {
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        if (!normalizedCurrentUserId || !rosterUserId) {
            return;
        }

        const rows = await notificationRepository.queryNotifications({
            userId: normalizedCurrentUserId,
            filters: ['boop']
        });
        const matchingRows = rows.filter(
            (row) =>
                row?.type === 'boop' &&
                !row.expired &&
                row.link === `user:${rosterUserId}`
        );
        await Promise.allSettled(
            matchingRows.map(async (row) => {
                try {
                    await notificationRepository.hideRemoteNotification({
                        id: row.id,
                        version: row.version,
                        type: row.type,
                        senderUserId: row.senderUserId,
                        endpoint: currentEndpoint
                    });
                } finally {
                    await notificationRepository.expireNotification({
                        userId: normalizedCurrentUserId,
                        id: row.id
                    });
                }
            })
        );
    }

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
            title: t('dialog.user.generated_modal.unfriend_user'),
            description: friend?.displayName || rosterUserId,
            confirmText: t('dialog.user.generated_modal.unfriend'),
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
                        'dialog.user.generated.unfriend_request_sent_but_the_active_session_changed_before_'
                    )
                );
            } else {
                setBaseProfile((currentProfile) =>
                    currentProfile
                        ? {
                              ...currentProfile,
                              isFriend: false,
                              friendRequestStatus: ''
                          }
                        : currentProfile
                );
                toast.success(
                    t('dialog.user.generated_dynamic.unfriended_value', {
                        value: friend?.displayName || rosterUserId
                    })
                );
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.generated_toast.failed_to_unfriend_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateFriendRequest(action) {
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
        function commitFriendRequestPatch(patch) {
            if (
                activeUserTargetRef.current.userId !== rosterUserId ||
                activeUserTargetRef.current.endpoint !== requestEndpoint
            ) {
                return false;
            }
            setBaseProfile((currentProfile) =>
                normalizeUserId(currentProfile?.id) === rosterUserId
                    ? { ...currentProfile, ...patch }
                    : currentProfile
            );
            return true;
        }

        const isSendAction = action === 'send' || action === 'accept';
        const label =
            action === 'accept'
                ? 'Accept friend request'
                : action === 'decline'
                  ? 'Decline friend request'
                  : action === 'cancel'
                    ? 'Cancel friend request'
                    : 'Send friend request';

        actionStatusRef.current = `friend-request:${action}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: t('dialog.user.generated_dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText:
                action === 'accept'
                    ? 'Accept'
                    : action === 'decline'
                      ? 'Decline'
                      : action === 'cancel'
                        ? 'Cancel Request'
                        : 'Send Request',
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
                        ? await findIncomingFriendRequestNotification(
                              rosterUserId
                          )
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
                            'dialog.user.generated.friend_request_is_no_longer_active'
                        )
                    );
                    return;
                }
                const response =
                    action === 'accept'
                        ? await notificationRepository.acceptFriendRequest({
                              id: incomingNotification.id,
                              endpoint: requestEndpoint
                          })
                        : await vrchatFriendRepository.sendFriendRequest({
                              userId: rosterUserId,
                              endpoint: requestEndpoint
                          });
                if (incomingNotification) {
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
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
                        ? t(
                              'dialog.user.generated_toast.friend_request_accepted'
                          )
                        : t('dialog.user.generated_toast.friend_request_sent')
                );
            } else {
                incomingNotification =
                    action === 'decline'
                        ? await findIncomingFriendRequestNotification(
                              rosterUserId
                          )
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
                            'dialog.user.generated.friend_request_is_no_longer_active'
                        )
                    );
                    return;
                }
                if (incomingNotification) {
                    await notificationRepository.hideRemoteNotification({
                        id: incomingNotification.id,
                        version: incomingNotification.version,
                        type: incomingNotification.type,
                        senderUserId: incomingNotification.senderUserId,
                        endpoint: requestEndpoint
                    });
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
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
                        ? t(
                              'dialog.user.generated_toast.friend_request_declined'
                          )
                        : t(
                              'dialog.user.generated_toast.friend_request_cancelled'
                          )
                );
            }
        } catch (error) {
            if (
                (action === 'accept' || action === 'decline') &&
                incomingNotification &&
                error?.status === 404
            ) {
                await notificationRepository
                    .expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
                    })
                    .catch(() => {});
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
                        'dialog.user.generated.friend_request_is_no_longer_active'
                    )
                );
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.generated_toast.value_failed', {
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
            title: t('dialog.user.generated_modal.report_hacking'),
            description: profile?.displayName || rosterUserId,
            confirmText: t('dialog.user.generated_modal.report'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'report-hacking';
        setActionStatus('report-hacking');
        try {
            await toolsRepository.reportUser(
                {
                    userId: rosterUserId,
                    contentType: 'user',
                    reason: 'behavior-hacking',
                    type: 'report'
                },
                { endpoint: currentEndpoint }
            );
            toast.success(t('dialog.user.generated.report_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.generated_toast.failed_to_report_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserBoop() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'boop';
        setActionStatus('boop');
        try {
            const result = await prompt({
                title: t('dialog.user.generated_modal.send_boop'),
                description: t(
                    'dialog.user.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'
                ),
                inputValue: '',
                confirmText: t('dialog.user.generated_modal.send'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }

            await dismissBoopNotifications(rosterUserId);
            await notificationRepository.sendBoop({
                userId: rosterUserId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.user.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.generated_toast.failed_to_send_boop')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function openGroupModerationForUser() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await prompt({
            title: t('dialog.user.generated_modal.group_moderation'),
            description: t(
                'dialog.user.generated_dynamic.enter_a_group_id_to_open_moderation_for_value',
                { value: profile?.displayName || rosterUserId }
            ),
            inputValue: '',
            confirmText: t('common.actions.open'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        const groupId = normalizeUserId(result.value);
        if (!groupId) {
            toast.error(t('dialog.user.generated.group_id_is_required'));
            return;
        }
        openGroupDialog({ groupId });
    }

    return {
        inviteMessageRequest,
        handleInviteMessageDialogOpenChange,
        selectInviteMessage,
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
