import { useLayoutEffect, useState } from 'react';
import { toast } from 'sonner';

import { backend } from '@/platform/index.js';
import {
    notificationRepository,
    toolsRepository,
    vrchatFriendRepository,
    vrchatModerationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { openGroupDialog } from '@/services/dialogService.js';
import friendRelationshipService from '@/services/friendRelationshipService.js';
import { appI18n } from '@/services/i18nService.js';
import { recordRecentAction } from '@/services/recentActionService.js';
import { parseLocation } from '@/shared/utils/location.js';

import { normalizeUserId } from './userProfileFields.js';

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
    const [inviteMessageRequest, setInviteMessageRequest] = useState(null);

    useLayoutEffect(() => {
        setInviteMessageRequest(null);
    }, [
        currentEndpoint,
        normalizedCurrentUserId,
        normalizedUserId,
        openNonce,
        profile?.id
    ]);

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
            title: appI18n.t('dialog.user.generated_modal.unfriend_user'),
            description: friend?.displayName || rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.unfriend'),
            cancelText: appI18n.t('common.actions.cancel'),
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
                    appI18n.t('dialog.user.generated.unfriend_request_sent_but_the_active_session_changed_before_')
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
                    appI18n.t('dialog.user.generated_dynamic.unfriended_value', { value: friend?.displayName || rosterUserId })
                );
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_unfriend_user')
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
            title: appI18n.t('dialog.user.generated_dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText:
                action === 'accept'
                    ? 'Accept'
                    : action === 'decline'
                      ? 'Decline'
                      : action === 'cancel'
                        ? 'Cancel Request'
                        : 'Send Request',
            cancelText: appI18n.t('common.actions.cancel'),
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
                    toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
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
                    recordDialogRecentAction(
                        rosterUserId,
                        'Send Friend Request'
                    );
                }
                toast.success(
                    isNowFriend
                        ? appI18n.t('dialog.user.generated_toast.friend_request_accepted')
                        : appI18n.t('dialog.user.generated_toast.friend_request_sent')
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
                    toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
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
                        ? appI18n.t('dialog.user.generated_toast.friend_request_declined')
                        : appI18n.t('dialog.user.generated_toast.friend_request_cancelled')
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
                toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
                return;
            }
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.value_failed', { value: label })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setUserModeration(type, enabled) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            (enabled && profile?.$isModerator) ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const label =
            type === 'block'
                ? enabled
                    ? 'Block'
                    : 'Unblock'
                : enabled
                  ? 'Mute'
                  : 'Unmute';

        actionStatusRef.current = `${type}:${enabled ? 'enable' : 'disable'}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_dynamic.value_user', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText: label,
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: enabled
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            if (enabled) {
                await vrchatModerationRepository.sendPlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            } else {
                await vrchatModerationRepository.deletePlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            }

            moderationRevisionRef.current += 1;
            const nextModerationState = {
                ...moderationState,
                [type]: enabled
            };
            if (currentUserId) {
                await userSessionRepository.ensureUserTables(currentUserId);
            }
            const savedState =
                await vrchatModerationRepository.saveLocalModeration({
                    ownerUserId: currentUserId,
                    userId: rosterUserId,
                    displayName: profile?.displayName || rosterUserId,
                    ...nextModerationState
                });
            setModerationState({
                block: Boolean(savedState.block),
                mute: Boolean(savedState.mute)
            });
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_request_sent', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_value_user', { value: label.toLowerCase() })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setExtendedUserModeration(type, enabled) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const labelMap = {
            interactOff: enabled
                ? 'Disable Avatar Interaction'
                : 'Enable Avatar Interaction',
            muteChat: enabled ? 'Disable Chatbox' : 'Enable Chatbox'
        };
        const label =
            labelMap[type] || (enabled ? `Enable ${type}` : `Disable ${type}`);

        actionStatusRef.current = `${type}:${enabled ? 'enable' : 'disable'}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText: label,
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: enabled
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            if (enabled) {
                await vrchatModerationRepository.sendPlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            } else {
                await vrchatModerationRepository.deletePlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            }
            setExtendedModerationState((current) => ({
                ...current,
                [type]: enabled
            }));
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_request_sent', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_value', { value: label.toLowerCase() })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setAvatarOverrideModeration(type) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            !normalizedCurrentUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const nextType =
            type === 'hideAvatar'
                ? avatarOverrideState.hideAvatar
                    ? 0
                    : 4
                : avatarOverrideState.showAvatar
                  ? 0
                  : 5;
        const label =
            type === 'hideAvatar'
                ? nextType === 0
                    ? 'Reset Hidden Avatar'
                    : 'Hide Avatar'
                : nextType === 0
                  ? 'Reset Shown Avatar'
                  : 'Show Avatar';

        actionStatusRef.current = `avatar-override:${nextType}`;
        setActionStatus(actionStatusRef.current);
        try {
            const result = await backend.app.SetVRChatUserModeration(
                normalizedCurrentUserId,
                rosterUserId,
                nextType
            );
            if (result === false) {
                throw new Error('Avatar moderation update failed.');
            }
            setAvatarOverrideState({
                hideAvatar: nextType === 4,
                showAvatar: nextType === 5
            });
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_updated', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_avatar_moderation')
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
            title: appI18n.t('dialog.user.generated_modal.report_hacking'),
            description: profile?.displayName || rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.report'),
            cancelText: appI18n.t('common.actions.cancel'),
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
            toast.success(appI18n.t('dialog.user.generated.report_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_report_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function inviteMessageSlot(row) {
        const value =
            row?.slot ?? row?.messageSlot ?? row?.requestSlot ?? row?.id;
        return Number.parseInt(value, 10);
    }

    function buildInviteContext({ requireCurrentUser = false } = {}) {
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
                appI18n.t('dialog.user.generated.cannot_load_message_templates_no_current_user_session_is_ava')
            );
            return null;
        }

        if (!currentInviteLocation) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_invite_no_current_vrchat_location_is_available')
            );
            return null;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(appI18n.t('dialog.user.generated.cannot_invite_from_the_current_instance_type'));
            return null;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_invite_current_location_is_not_a_concrete_instance')
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

    function buildInviteRequestContext({ requireCurrentUser = false } = {}) {
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
                appI18n.t('dialog.user.generated.cannot_load_message_templates_no_current_user_session_is_ava')
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

    function recordDialogRecentAction(userId, actionType) {
        recordRecentAction(userId, actionType);
    }

    async function performSendUserInvite({
        messageSlot = null,
        context: contextSnapshot = null
    } = {}) {
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
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                context.parsedLocation.worldId,
                { endpoint: context.endpoint }
            );
            const params = {
                instanceId: context.inviteLocation,
                worldId: context.parsedLocation.worldId,
                worldName:
                    worldResponse.json?.name || context.parsedLocation.worldId,
                rsvp: true
            };
            if (messageSlot !== null) {
                params.messageSlot = messageSlot;
            }
            await notificationRepository.sendInvite({
                receiverUserId: context.rosterUserId,
                endpoint: context.endpoint,
                params
            });
            recordDialogRecentAction(
                context.rosterUserId,
                messageSlot !== null ? 'Invite Message' : 'Invite'
            );
            toast.success(
                messageSlot !== null ? appI18n.t('dialog.user.generated_toast.invite_message_sent') : appI18n.t('dialog.user.generated_toast.invite_sent')
            );
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_send_invite')
            );
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserInvite({ withMessage = false } = {}) {
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
            title: appI18n.t('dialog.user.generated_modal.send_invite'),
            description: profile?.displayName || context.rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.invite'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await performSendUserInvite({ context });
    }

    async function performSendUserInviteRequest({
        requestSlot = null,
        context: contextSnapshot = null
    } = {}) {
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
            const params = {
                platform: 'standalonewindows'
            };
            if (requestSlot !== null) {
                params.requestSlot = requestSlot;
            }
            await notificationRepository.sendRequestInvite({
                receiverUserId: context.rosterUserId,
                endpoint: context.endpoint,
                params
            });
            recordDialogRecentAction(
                context.rosterUserId,
                requestSlot !== null
                    ? 'Request Invite Message'
                    : 'Request Invite'
            );
            toast.success(
                requestSlot !== null
                    ? appI18n.t('dialog.user.generated_toast.invite_request_message_sent')
                    : appI18n.t('dialog.user.generated_toast.invite_request_sent')
            );
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_request_invite')
            );
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserInviteRequest({ withMessage = false } = {}) {
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
            title: appI18n.t('dialog.user.generated_modal.request_invite'),
            description: profile?.displayName || context.rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.request_invite_2'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await performSendUserInviteRequest({ context });
    }

    async function selectInviteMessage({ row }) {
        const slot = inviteMessageSlot(row);
        if (!Number.isFinite(slot)) {
            toast.error(appI18n.t('dialog.user.generated.invite_message_slot_must_be_a_number'));
            return false;
        }

        const request = inviteMessageRequest;
        const sent =
            request?.kind === 'request'
                ? await performSendUserInviteRequest({
                      requestSlot: slot,
                      context: request.context
                  })
                : await performSendUserInvite({
                      messageSlot: slot,
                      context: request?.context
                  });

        if (sent) {
            setInviteMessageRequest(null);
        }
        return sent;
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
                title: appI18n.t('dialog.user.generated_modal.send_boop'),
                description:
                    appI18n.t('dialog.user.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'),
                inputValue: '',
                confirmText: appI18n.t('dialog.user.generated_modal.send'),
                cancelText: appI18n.t('common.actions.cancel')
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
            toast.success(appI18n.t('dialog.user.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.failed_to_send_boop')
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
            title: appI18n.t('dialog.user.generated_modal.group_moderation'),
            description: appI18n.t('dialog.user.generated_dynamic.enter_a_group_id_to_open_moderation_for_value', { value: profile?.displayName || rosterUserId }),
            inputValue: '',
            confirmText: appI18n.t('common.actions.open'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        const groupId = normalizeUserId(result.value);
        if (!groupId) {
            toast.error(appI18n.t('dialog.user.generated.group_id_is_required'));
            return;
        }
        openGroupDialog({ groupId });
    }

    const handleInviteMessageDialogOpenChange = (nextOpen) => {
        if (!nextOpen && actionStatusRef.current === 'idle') {
            setInviteMessageRequest(null);
        }
    };

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
