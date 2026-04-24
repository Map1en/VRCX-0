export function useFavoritesItemActions({
    avatarHistoryLoading,
    avatarLocalRepository,
    avatarProfileRepository,
    canInviteFromCurrentLocation,
    checkCanInviteSelf,
    configRepository,
    confirm,
    contentItems,
    createLocalFavoriteGroup,
    currentEndpoint,
    currentInviteLocation,
    currentUserId,
    friendsById,
    friendsMap,
    isAllSelected,
    kind,
    localFavoritesRepository,
    localGroups,
    newLocalGroupName,
    normalizeEntityId,
    notificationRepository,
    openWorldDialog,
    parseLocation,
    prompt,
    refreshing,
    resolveFavoritePresenceLocation,
    selectedContentItems,
    selectedSource,
    selfInviteToInstance,
    setAvatarHistory,
    setAvatarHistoryLoading,
    setCreatingLocalGroup,
    setNewLocalGroupName,
    setSelectedGroupKey,
    setSelectedKeys,
    setSelectedSource,
    t,
    toast,
    tryOpenLaunchLocation,
    vrchatSearchRepository
}) {
    async function refreshAvatarHistory() {
        if (kind !== 'avatar' || !currentUserId || avatarHistoryLoading) {
            return;
        }
        setAvatarHistoryLoading(true);
        try {
            const rows = await avatarLocalRepository.getAvatarHistory(
                currentUserId,
                100
            );
            setAvatarHistory(Array.isArray(rows) ? rows : []);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_refresh_avatar_history'
                      )
            );
        } finally {
            setAvatarHistoryLoading(false);
        }
    }
    async function handleAvatarHistoryClear() {
        const result = await confirm({
            title: t('view.favorites.generated_modal.clear_avatar_history'),
            description: t(
                'view.favorites.generated_modal.clear_local_avatar_history_and_cached_avatar_met'
            ),
            destructive: true,
            confirmText: t('common.actions.clear'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await avatarLocalRepository.clearAvatarHistory(currentUserId);
            setAvatarHistory([]);
            if (selectedSource === 'history') {
                setSelectedGroupKey('');
            }
            toast.success(t('view.favorite.generated.avatar_history_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_clear_avatar_history'
                      )
            );
        }
    }
    function getFavoriteFriend(item) {
        const userId = normalizeEntityId(item?.id);
        return (
            item?.seedData ||
            friendsById[userId] || {
                id: userId,
                displayName: item?.title || userId,
                location: ''
            }
        );
    }
    async function launchFavoriteFriendLocation(item) {
        const friend = getFavoriteFriend(item);
        const location = resolveFavoritePresenceLocation(friend);
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
                    t('view.favorite.generated.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t(
                    'view.favorite.generated.unable_to_open_this_instance_in_vrchat'
                )
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_launch_instance'
                      )
            );
        }
    }
    async function selfInviteFavoriteFriendLocation(item) {
        const friend = getFavoriteFriend(item);
        const location = resolveFavoritePresenceLocation(friend);
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }
        if (
            !checkCanInviteSelf(location, {
                currentUserId,
                cachedInstances: new Map(),
                friends: friendsMap
            })
        ) {
            toast.error(
                t('view.favorite.generated.cannot_self_invite_to_this_instance')
            );
            return;
        }
        try {
            await selfInviteToInstance(
                location,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            toast.success(t('view.favorite.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_send_self_invite'
                      )
            );
        }
    }
    async function sendFavoriteFriendInvite(item) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t(
                    'view.favorite.generated.cannot_invite_no_current_vrchat_location_is_available'
                )
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(
                t(
                    'view.favorite.generated.cannot_invite_from_the_current_instance_type'
                )
            );
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'view.favorite.generated.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        const result = await confirm({
            title: t('view.favorites.generated_modal.send_invite'),
            description:
                friend?.displayName || t('view.favorites.generated.this_user'),
            confirmText: t('view.favorites.generated_modal.invite'),
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
            toast.success(t('view.favorite.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_send_invite')
            );
        }
    }
    async function requestFavoriteFriendInvite(item) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: t('view.favorites.generated_modal.request_invite'),
            description:
                friend?.displayName || t('view.favorites.generated.this_user'),
            confirmText: t('view.favorites.generated_modal.request_invite_2'),
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
            toast.success(t('view.favorite.generated.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_request_invite'
                      )
            );
        }
    }
    async function sendFavoriteFriendBoop(item) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        try {
            const result = await prompt({
                title: t('view.favorites.generated_modal.send_boop'),
                description: t(
                    'view.favorites.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'
                ),
                inputValue: '',
                confirmText: t('view.favorites.generated_modal.send'),
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
            toast.success(t('view.favorite.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_send_boop')
            );
        }
    }
    function openWorldNewInstance(item, selfInvite = false) {
        if (!item?.id) {
            return;
        }
        openWorldDialog({
            worldId: item.id,
            title: item.title || undefined,
            seedData: item.seedData ?? null,
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance'
        });
    }
    async function selectFavoriteAvatar(item) {
        if (!item?.id) {
            return;
        }
        const shouldConfirm = await configRepository.getBool(
            'showConfirmationOnSwitchAvatar',
            true
        );
        if (shouldConfirm) {
            const result = await confirm({
                title: t('view.favorites.generated_modal.select_avatar'),
                description:
                    item.title || t('view.favorites.generated.avatar_fallback'),
                confirmText: t('common.actions.select'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
        }
        try {
            await avatarProfileRepository.selectAvatar({
                avatarId: item.id,
                endpoint: currentEndpoint
            });
            toast.success(t('view.favorite.generated.avatar_selected'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_select_avatar'
                      )
            );
        }
    }
    async function confirmCreateLocalGroup() {
        if (refreshing) {
            return;
        }
        const nextName = newLocalGroupName.trim();
        if (!nextName) {
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
            return;
        }
        if (localGroups.some((group) => group.key === nextName)) {
            toast.error(
                t(
                    'view.favorites.generated_dynamic.local_group_value_already_exists',
                    {
                        value: nextName
                    }
                )
            );
            return;
        }
        try {
            await localFavoritesRepository.createLocalFavoriteGroup({
                kind,
                groupName: nextName
            });
            createLocalFavoriteGroup({
                kind,
                groupName: nextName
            });
            setSelectedSource('local');
            setSelectedGroupKey(nextName);
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_create_local_favorite_group'
                      )
            );
        }
    }
    function toggleSelectAll() {
        if (isAllSelected) {
            setSelectedKeys([]);
            return;
        }
        setSelectedKeys(contentItems.map((item) => item.key));
    }
    async function copySelection() {
        if (!selectedContentItems.length) {
            return;
        }
        try {
            await navigator.clipboard.writeText(
                selectedContentItems.map((item) => `${item.id}\n`).join('')
            );
            toast.success(
                t('view.favorite.generated.copied_selected_favorite_ids')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_copy_selected_favorites'
                      )
            );
        }
    }
    return {
        refreshAvatarHistory,
        handleAvatarHistoryClear,
        launchFavoriteFriendLocation,
        selfInviteFavoriteFriendLocation,
        sendFavoriteFriendInvite,
        requestFavoriteFriendInvite,
        sendFavoriteFriendBoop,
        openWorldNewInstance,
        selectFavoriteAvatar,
        confirmCreateLocalGroup,
        toggleSelectAll,
        copySelection
    };
}
