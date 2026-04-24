export function useFeedPageActions({
    FEED_FILTER_TYPES,
    canInviteFromCurrentLocation,
    canRequestInviteFromFeedFriend,
    checkCanInviteSelf,
    confirm,
    currentEndpoint,
    currentInviteLocation,
    currentUserId,
    currentUserSnapshot,
    dateDraftFrom,
    dateDraftTo,
    friendsMap,
    gameLogRepository,
    loadingPreviousInstancesKey,
    normalizeId,
    notificationRepository,
    openWorldDialog,
    parseLocation,
    prompt,
    searchDraft,
    selfInviteToInstance,
    setActiveFilters,
    setDateDraftFrom,
    setDateDraftTo,
    setDateFilterOpen,
    setDateFrom,
    setDateTo,
    setLoadingPreviousInstancesKey,
    setPreviousInstancesOpen,
    setPreviousInstancesRows,
    setPreviousInstancesTitle,
    setSearchDraft,
    setSearchQuery,
    t,
    toast,
    tryOpenLaunchLocation,
    vrchatSearchRepository
}) {
    function setFeedFilters(nextFilters) {
        const nextUniqueFilters = [
            ...new Set(
                (Array.isArray(nextFilters) ? nextFilters : []).filter(
                    (filter) => FEED_FILTER_TYPES.includes(filter)
                )
            )
        ];
        setActiveFilters(
            nextUniqueFilters.length === FEED_FILTER_TYPES.length
                ? []
                : nextUniqueFilters
        );
    }
    function toggleFeedFilter(filter) {
        setActiveFilters((current) => {
            const nextFilters = current.includes(filter)
                ? current.filter((entry) => entry !== filter)
                : [...current, filter];
            return nextFilters.length === FEED_FILTER_TYPES.length
                ? []
                : nextFilters;
        });
    }
    function commitSearch(nextValue = searchDraft) {
        setSearchQuery(nextValue);
    }
    function clearSearch() {
        setSearchDraft('');
        setSearchQuery('');
    }
    function applyDateFilter() {
        if (dateDraftFrom && dateDraftTo && dateDraftFrom > dateDraftTo) {
            setDateFrom(dateDraftTo);
            setDateTo(dateDraftFrom);
        } else {
            setDateFrom(dateDraftFrom);
            setDateTo(dateDraftTo);
        }
        setDateFilterOpen(false);
    }
    function clearDateFilter() {
        setDateDraftFrom('');
        setDateDraftTo('');
        setDateFrom('');
        setDateTo('');
        setDateFilterOpen(false);
    }
    async function openPreviousInstancesForLocation({
        location = '',
        worldId = '',
        worldName = '',
        groupName = ''
    } = {}) {
        const normalizedLocation = normalizeId(location);
        const normalizedWorldId =
            normalizeId(worldId) || parseLocation(normalizedLocation).worldId;
        if (!normalizedWorldId || loadingPreviousInstancesKey) {
            return;
        }
        setLoadingPreviousInstancesKey(normalizedLocation || normalizedWorldId);
        try {
            const instances =
                await gameLogRepository.getPreviousInstancesByWorldId({
                    worldId: normalizedWorldId
                });
            const sortedInstances = [...instances].sort((left, right) => {
                if (normalizedLocation) {
                    if (normalizeId(left?.location) === normalizedLocation) {
                        return -1;
                    }
                    if (normalizeId(right?.location) === normalizedLocation) {
                        return 1;
                    }
                }
                return (
                    Date.parse(right?.created_at || right?.createdAt || 0) -
                    Date.parse(left?.created_at || left?.createdAt || 0)
                );
            });
            setPreviousInstancesRows(sortedInstances);
            setPreviousInstancesTitle(
                `Instance History - ${[worldName || 'World', groupName].filter(Boolean).join(' / ') || 'World'}`
            );
            setPreviousInstancesOpen(true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.feed.generated_toast.failed_to_load_instance_history'
                      )
            );
        } finally {
            setLoadingPreviousInstancesKey('');
        }
    }
    function canUseFeedFriendLocation(location) {
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
    async function launchFeedFriendLocation(location) {
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
                    t('view.feed.generated.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t('view.feed.generated.unable_to_open_this_instance_in_vrchat')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_launch_instance')
            );
        }
    }
    async function selfInviteFeedFriendLocation(location) {
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
            toast.success(t('view.feed.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_send_self_invite')
            );
        }
    }
    async function sendFeedFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t(
                    'view.feed.generated.cannot_invite_no_current_vrchat_location_is_available'
                )
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(
                t(
                    'view.feed.generated.cannot_invite_from_the_current_instance_type'
                )
            );
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'view.feed.generated.cannot_invite_current_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        const result = await confirm({
            title: t('view.feed.generated_modal.send_invite'),
            description: friend?.displayName || 'this user',
            confirmText: t('view.feed.generated_modal.invite'),
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
            toast.success(t('view.feed.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_send_invite')
            );
        }
    }
    async function requestFeedFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!canRequestInviteFromFeedFriend(friend, currentUserSnapshot)) {
            toast.error(
                t(
                    'view.feed.generated.cannot_request_invite_friend_is_not_online'
                )
            );
            return;
        }
        const result = await confirm({
            title: t('view.feed.generated_modal.request_invite'),
            description: friend?.displayName || 'this user',
            confirmText: t('view.feed.generated_modal.request_invite_2'),
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
            toast.success(t('view.feed.generated.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_request_invite')
            );
        }
    }
    async function sendFeedFriendBoop(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        try {
            const result = await prompt({
                title: t('view.feed.generated_modal.send_boop'),
                description: t(
                    'view.feed.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'
                ),
                inputValue: '',
                confirmText: t('view.feed.generated_modal.send'),
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
            toast.success(t('view.feed.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.feed.generated_toast.failed_to_send_boop')
            );
        }
    }
    function openFeedNewInstance({
        location = '',
        worldId = '',
        worldName = '',
        selfInvite = false
    } = {}) {
        const target =
            normalizeId(worldId) ||
            parseLocation(location).worldId ||
            normalizeId(location);
        if (!target) {
            return;
        }
        openWorldDialog({
            worldId: target,
            title: worldName || target,
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance'
        });
    }
    return {
        setFeedFilters,
        toggleFeedFilter,
        commitSearch,
        clearSearch,
        applyDateFilter,
        clearDateFilter,
        openPreviousInstancesForLocation,
        canUseFeedFriendLocation,
        launchFeedFriendLocation,
        selfInviteFeedFriendLocation,
        sendFeedFriendInvite,
        requestFeedFriendInvite,
        sendFeedFriendBoop,
        openFeedNewInstance
    };
}
