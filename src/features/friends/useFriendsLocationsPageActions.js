export function useFriendsLocationsPageActions({
    canInviteFromCurrentLocation,
    checkCanInviteSelf,
    confirm,
    currentEndpoint,
    currentInviteLocation,
    currentUserId,
    friendsMap,
    normalizeId,
    notificationRepository,
    openGroupDialog,
    openUserDialog,
    openWorldDialog,
    parseLocation,
    prompt,
    resolveWorldDialogTarget,
    selfInviteToInstance,
    setCollapsedFavoriteGroups,
    t,
    toast,
    tryOpenLaunchLocation,
    vrchatSearchRepository
}) {
    function toggleFavoriteGroup(groupKey) {
        setCollapsedFavoriteGroups((current) => {
            const next = new Set(current);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    }
    function canUseFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return false;
        }
        return checkCanInviteSelf(location, {
            currentUserId,
            cachedInstances: new Map(),
            friends: friendsMap
        });
    }
    async function launchFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }
        try {
            const opened = await tryOpenLaunchLocation(
                location,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            if (opened) {
                toast.success(
                    t('view.friend_list.generated.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t(
                    'view.friend_list.generated.unable_to_open_this_instance_in_vrchat'
                )
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.friends.generated_toast.failed_to_launch_instance'
                      )
            );
        }
    }
    async function selfInviteFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }
        try {
            await selfInviteToInstance(
                location,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            toast.success(t('view.friend_list.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.friends.generated_toast.failed_to_send_self_invite'
                      )
            );
        }
    }
    async function sendFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t(
                    'view.friend_list.generated.cannot_invite_no_current_vrchat_location_is_available'
                )
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(
                t(
                    'view.friend_list.generated.cannot_invite_from_the_current_instance_type'
                )
            );
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'view.friend_list.generated.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        const result = await confirm({
            title: t('view.friends.generated_modal.send_invite'),
            description: friend?.displayName || friend?.username || 'this user',
            confirmText: t('view.friends.generated_modal.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                {
                    endpoint: currentEndpoint
                }
            );
            const inviteLocation = parsedLocation.tag || currentInviteLocation;
            await notificationRepository.sendInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    instanceId: inviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName:
                        worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            toast.success(t('view.friend_list.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.generated_toast.failed_to_send_invite')
            );
        }
    }
    async function requestFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: t('view.friends.generated_modal.request_invite'),
            description: friend?.displayName || friend?.username || 'this user',
            confirmText: t('view.friends.generated_modal.request_invite_2'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await notificationRepository.sendRequestInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    platform: 'standalonewindows'
                }
            });
            toast.success(t('view.friend_list.generated.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.generated_toast.failed_to_request_invite')
            );
        }
    }
    async function sendFriendBoop(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        try {
            const result = await prompt({
                title: t('view.friends.generated_modal.send_boop'),
                description: t(
                    'view.friends.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'
                ),
                inputValue: '',
                confirmText: t('view.friends.generated_modal.send'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.sendBoop({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(t('view.friend_list.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.friends.generated_toast.failed_to_send_boop')
            );
        }
    }
    function openSectionWorld(section) {
        openWorldDialog({
            worldId: resolveWorldDialogTarget(section),
            title: section.title
        });
    }
    function openSectionGroup(section) {
        openGroupDialog({
            groupId: section.groupId,
            title: undefined
        });
    }
    function openFriendUser(friend) {
        openUserDialog({
            userId: friend?.id,
            title: friend?.displayName || friend?.username || undefined,
            seedData: friend
        });
    }
    function openFriendWorld(target, location) {
        openWorldDialog({
            worldId: resolveWorldDialogTarget(target),
            title: location.label || undefined
        });
    }
    function openFriendGroup(target) {
        openGroupDialog({
            groupId: target.groupId,
            title: undefined
        });
    }
    return {
        toggleFavoriteGroup,
        canUseFriendLocation,
        launchFriendLocation,
        selfInviteFriendLocation,
        sendFriendInvite,
        requestFriendInvite,
        sendFriendBoop,
        openSectionWorld,
        openSectionGroup,
        openFriendUser,
        openFriendWorld,
        openFriendGroup
    };
}
