import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { useLocationMetadataBatch } from '@/components/location/useLocationMetadata.js';
import { useVirtualSidebarRows } from '@/components/sidebar/virtualSidebarRows.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    configRepository,
    notificationRepository,
    userProfileRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import {
    recordRecentAction,
    subscribeRecentActions
} from '@/services/recentActionService.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/location.js';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields
} from '@/shared/utils/currentUserPresence.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { appI18n } from '@/services/i18nService.js';
import {
    buildFavoriteIdSet,
    buildSameInstanceGroups,
    normalizeLocationStatus,
    normalizeId,
    readFriendStatusSource,
    resolveCurrentInviteLocation,
    resolveCurrentUserStateBucket,
    sortRows
} from './friends-sidebar/friendsSidebarModel.js';
import {
    buildSidebarLocationMetadataEntry,
    estimateFriendSidebarRowSize,
} from './friends-sidebar/FriendsSidebarRows.jsx';
import { FriendsSidebarVirtualRow } from './friends-sidebar/FriendsSidebarVirtualRows.jsx';

const groupToggleKeys = {
    me: 'isFriendsGroupMe',
    favorites: 'isFriendsGroupFavorites',
    online: 'isFriendsGroupOnline',
    active: 'isFriendsGroupActive',
    offline: 'isFriendsGroupOffline',
    sameInstance: 'sidebarGroupByInstanceCollapsed'
};

const defaultGroupState = {
    me: true,
    favorites: true,
    online: true,
    active: false,
    offline: true,
    sameInstance: true
};
export function FriendsSidebar({ prefs }) {
    const { t } = useI18n();
    const themeMode = useShellStore((state) => state.themeMode);
    const timeUnitLabels = useShellStore((state) => state.timeUnitLabels);
    const currentUser = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const gameState = useRuntimeStore((state) => state.gameState);
    const currentLocation =
        gameState.currentLocation === 'traveling'
            ? gameState.currentDestination
            : gameState.currentLocation;
    const currentLocationPlayerIds = gameState.currentLocationPlayerIds;
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const activeIds = useFriendRosterStore((state) => state.activeIds);
    const offlineIds = useFriendRosterStore((state) => state.offlineIds);
    const loadStatus = useFriendRosterStore((state) => state.loadStatus);
    const detail = useFriendRosterStore((state) => state.detail);
    const favoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const trustColor = usePreferencesStore((state) => state.trustColor);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const ageGatedInstancesVisiblePreference = usePreferencesStore(
        (state) => state.isAgeGatedInstancesVisible
    );
    const showInstanceIdInLocation = usePreferencesStore(
        (state) => state.showInstanceIdInLocation
    );
    const [openGroups, setOpenGroups] = useState(defaultGroupState);
    const [statusPresets, setStatusPresets] = useState([]);
    const [recentActionVersion, setRecentActionVersion] = useState(0);
    const sameInstanceFallbackJoinTimesRef = useRef(new Map());
    const isDarkMode =
        themeMode === 'dark' ||
        (typeof document !== 'undefined' &&
            document.documentElement.classList.contains('dark'));
    const ageGatedInstancesVisible =
        preferencesHydrated && ageGatedInstancesVisiblePreference;
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUser),
        [currentUser, gameState]
    );
    const currentLocationSnapshot = useMemo(
        () => ({
            location: currentLocation,
            friendList: new Set(
                Array.isArray(currentLocationPlayerIds)
                    ? currentLocationPlayerIds
                    : []
            )
        }),
        [currentLocation, currentLocationPlayerIds]
    );
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, currentUserId]
    );

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getBool(groupToggleKeys.me, true),
            configRepository.getBool(groupToggleKeys.favorites, true),
            configRepository.getBool(groupToggleKeys.online, true),
            configRepository.getBool(groupToggleKeys.active, false),
            configRepository.getBool(groupToggleKeys.offline, true),
            configRepository.getBool(groupToggleKeys.sameInstance, false)
        ])
            .then(
                ([
                    me,
                    favorites,
                    online,
                    activeFriends,
                    offline,
                    sameInstanceCollapsed
                ]) => {
                    if (!active) {
                        return;
                    }
                    setOpenGroups({
                        me: Boolean(me),
                        favorites: Boolean(favorites),
                        online: Boolean(online),
                        active: Boolean(activeFriends),
                        offline: Boolean(offline),
                        sameInstance: !sameInstanceCollapsed
                    });
                }
            )
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        configRepository
            .getArray('VRCX_statusPresets', [])
            .then((nextPresets) => {
                if (active) {
                    setStatusPresets(
                        Array.isArray(nextPresets) ? nextPresets : []
                    );
                }
            })
            .catch(() => {
                if (active) {
                    setStatusPresets([]);
                }
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(
        () =>
            subscribeRecentActions(() => {
                setRecentActionVersion((version) => version + 1);
            }),
        []
    );

    const rows = useMemo(
        () => orderedFriendIds.map((id) => friendsById[id]).filter(Boolean),
        [friendsById, orderedFriendIds]
    );
    const favoriteIds = useMemo(
        () => buildFavoriteIdSet(favoriteFriendIds, localFriendFavorites),
        [favoriteFriendIds, localFriendFavorites]
    );
    const allFavoriteGroupKeys = useMemo(
        () => [
            ...(favoriteFriendGroups || [])
                .map((group) => group.key)
                .filter(Boolean),
            ...(localFriendFavoriteGroups?.length
                ? localFriendFavoriteGroups
                : Object.keys(localFriendFavorites || {})
            ).map((groupName) => `local:${groupName}`)
        ],
        [favoriteFriendGroups, localFriendFavoriteGroups, localFriendFavorites]
    );
    const selectedFavoriteGroupKeys = useMemo(() => {
        const configured = Array.isArray(prefs.sidebarFavoriteGroups)
            ? prefs.sidebarFavoriteGroups.filter(Boolean)
            : [];
        if (!configured.length) {
            return new Set(allFavoriteGroupKeys);
        }
        return new Set(configured);
    }, [allFavoriteGroupKeys, prefs.sidebarFavoriteGroups]);
    const hasFavoriteGroupFilter = useMemo(
        () =>
            Array.isArray(prefs.sidebarFavoriteGroups) &&
            prefs.sidebarFavoriteGroups.length > 0,
        [prefs.sidebarFavoriteGroups]
    );
    const selectedFavoriteIds = useMemo(() => {
        if (!allFavoriteGroupKeys.length) {
            return favoriteIds;
        }
        const ids = new Set();
        for (const key of selectedFavoriteGroupKeys) {
            if (key.startsWith('local:')) {
                for (const id of localFriendFavorites?.[key.slice(6)] || []) {
                    const normalized = normalizeId(id);
                    if (normalized) {
                        ids.add(normalized);
                    }
                }
            } else {
                for (const id of groupedFavoriteFriendIdsByGroupKey?.[key] ||
                    []) {
                    const normalized = normalizeId(id);
                    if (normalized) {
                        ids.add(normalized);
                    }
                }
            }
        }
        return ids;
    }, [
        allFavoriteGroupKeys,
        favoriteIds,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavorites,
        selectedFavoriteGroupKeys
    ]);
    const excludedFavoriteIds = hasFavoriteGroupFilter
        ? selectedFavoriteIds
        : favoriteIds;
    const sameInstanceGroups = useMemo(() => {
        if (!prefs.sidebarGroupByInstance) {
            return [];
        }
        return buildSameInstanceGroups(
            rows,
            prefs,
            currentLocationSnapshot,
            sameInstanceFallbackJoinTimesRef.current
        );
    }, [currentLocationSnapshot, prefs, rows]);
    const sameInstanceIds = useMemo(
        () =>
            new Set(
                sameInstanceGroups.flatMap((group) =>
                    group.rows.map((friend) => friend.id)
                )
            ),
        [sameInstanceGroups]
    );
    const onlineIdSet = useMemo(() => new Set(onlineIds), [onlineIds]);
    const favoriteRows = useMemo(
        () =>
            sortRows(
                rows.filter((friend) => {
                    const source = readFriendStatusSource(friend);
                    const state = normalizeLocationStatus(
                        source?.stateBucket || source?.state
                    );
                    return (
                        selectedFavoriteIds.has(normalizeId(friend?.id)) &&
                        state === 'online' &&
                        !(
                            prefs.isHideFriendsInSameInstance &&
                            sameInstanceIds.has(friend.id)
                        )
                    );
                }),
                prefs
            ),
        [prefs, rows, sameInstanceIds, selectedFavoriteIds]
    );
    const onlineRows = useMemo(
        () =>
            sortRows(
                onlineIds
                    .map((id) => friendsById[id])
                    .filter(
                        (friend) =>
                            friend &&
                            !excludedFavoriteIds.has(normalizeId(friend.id)) &&
                            !(
                                prefs.isHideFriendsInSameInstance &&
                                sameInstanceIds.has(friend.id)
                            )
                    ),
                prefs
            ),
        [excludedFavoriteIds, friendsById, onlineIds, prefs, sameInstanceIds]
    );
    const activeRows = useMemo(
        () =>
            sortRows(
                activeIds.map((id) => friendsById[id]).filter(Boolean),
                prefs
            ),
        [activeIds, friendsById, prefs]
    );
    const offlineRows = useMemo(
        () =>
            sortRows(
                offlineIds.map((id) => friendsById[id]).filter(Boolean),
                prefs
            ),
        [offlineIds, friendsById, prefs]
    );
    const favoriteGroupSections = useMemo(() => {
        if (!prefs.isSidebarDivideByFriendGroup) {
            return [];
        }
        const favoriteRowById = new Map(
            favoriteRows.map((friend) => [normalizeId(friend.id), friend])
        );
        const seen = new Set();
        const sections = [];

        const orderedRemoteGroups = [...(favoriteFriendGroups || [])].sort(
            (left, right) => {
                const order = Array.isArray(prefs.sidebarFavoriteGroupOrder)
                    ? prefs.sidebarFavoriteGroupOrder
                    : [];
                const leftIndex = order.indexOf(left.key);
                const rightIndex = order.indexOf(right.key);
                if (leftIndex >= 0 && rightIndex >= 0) {
                    return leftIndex - rightIndex;
                }
                if (leftIndex >= 0) {
                    return -1;
                }
                if (rightIndex >= 0) {
                    return 1;
                }
                return String(
                    left.displayName || left.name || left.key || ''
                ).localeCompare(
                    String(right.displayName || right.name || right.key || '')
                );
            }
        );
        const orderedLocalGroups = [
            ...(localFriendFavoriteGroups?.length
                ? localFriendFavoriteGroups
                : Object.keys(localFriendFavorites || {}))
        ].sort((left, right) => {
            const order = Array.isArray(prefs.sidebarFavoriteGroupOrder)
                ? prefs.sidebarFavoriteGroupOrder
                : [];
            const leftIndex = order.indexOf(`local:${left}`);
            const rightIndex = order.indexOf(`local:${right}`);
            if (leftIndex >= 0 && rightIndex >= 0) {
                return leftIndex - rightIndex;
            }
            if (leftIndex >= 0) {
                return -1;
            }
            if (rightIndex >= 0) {
                return 1;
            }
            return String(left).localeCompare(String(right));
        });

        for (const group of orderedRemoteGroups) {
            if (!selectedFavoriteGroupKeys.has(group.key)) {
                continue;
            }
            const rowsForGroup = (
                groupedFavoriteFriendIdsByGroupKey?.[group.key] || []
            )
                .map((id) => favoriteRowById.get(normalizeId(id)))
                .filter(Boolean);
            if (rowsForGroup.length) {
                rowsForGroup.forEach((friend) =>
                    seen.add(normalizeId(friend.id))
                );
                sections.push({
                    key: group.key,
                    label: group.displayName || group.name || group.key,
                    rows: sortRows(rowsForGroup, prefs)
                });
            }
        }

        for (const groupName of orderedLocalGroups) {
            if (!selectedFavoriteGroupKeys.has(`local:${groupName}`)) {
                continue;
            }
            const rowsForGroup = (localFriendFavorites?.[groupName] || [])
                .map((id) => favoriteRowById.get(normalizeId(id)))
                .filter(Boolean);
            if (rowsForGroup.length) {
                rowsForGroup.forEach((friend) =>
                    seen.add(normalizeId(friend.id))
                );
                sections.push({
                    key: `local:${groupName}`,
                    label: groupName,
                    rows: sortRows(rowsForGroup, prefs)
                });
            }
        }

        const ungrouped = favoriteRows.filter(
            (friend) => !seen.has(normalizeId(friend.id))
        );
        if (ungrouped.length) {
            sections.push({
                key: 'ungrouped',
                label: t('side_panel.favorite'),
                rows: ungrouped
            });
        }

        return sections;
    }, [
        favoriteFriendGroups,
        favoriteRows,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites,
        prefs,
        selectedFavoriteGroupKeys,
        t
    ]);

    function toggleSection(id) {
        setOpenGroups((current) => {
            const next = {
                ...current,
                [id]: !current[id]
            };
            const configKey = groupToggleKeys[id];
            if (configKey) {
                void configRepository.setBool(
                    configKey,
                    id === 'sameInstance' ? !next[id] : next[id]
                );
            }
            return next;
        });
    }

    function openFriend(friend) {
        openUserDialog({
            userId: friend.id,
            title: friend.displayName || friend.username || undefined,
            seedData: friend
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
                parsedLocation.shortName,
                currentEndpoint
            );
            if (opened) {
                toast.success(t('side_panel.generated.vrchat_launch_request_sent'));
                return;
            }
            toast.error(t('side_panel.generated.unable_to_open_this_instance_in_vrchat'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('component.friends_sidebar.generated_toast.failed_to_launch_instance')
            );
        }
    }

    async function selfInviteToFriendLocation(location) {
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
                parsedLocation.shortName,
                currentEndpoint
            );
            toast.success(t('side_panel.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('component.friends_sidebar.generated_toast.failed_to_send_self_invite')
            );
        }
    }

    async function sendFriendInvite(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                t('side_panel.generated.cannot_invite_no_current_vrchat_location_is_available')
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(t('side_panel.generated.cannot_invite_from_the_current_instance_type'));
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t('side_panel.generated.cannot_invite_current_location_is_not_a_concrete_instance')
            );
            return;
        }
        const result = await confirm({
            title: appI18n.t('component.friends_sidebar.generated_modal.send_invite'),
            description: friend.displayName || friendId,
            confirmText: appI18n.t('component.friends_sidebar.generated_modal.invite'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                { endpoint: currentEndpoint }
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
            recordRecentAction(friendId, 'Invite');
            toast.success(t('side_panel.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('component.friends_sidebar.generated_toast.failed_to_send_invite')
            );
        }
    }

    async function requestFriendInvite(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: appI18n.t('component.friends_sidebar.generated_modal.request_invite'),
            description: friend.displayName || friendId,
            confirmText: appI18n.t('component.friends_sidebar.generated_modal.request_invite_2'),
            cancelText: appI18n.t('common.actions.cancel')
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
            recordRecentAction(friendId, 'Request Invite');
            toast.success(t('side_panel.generated.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('component.friends_sidebar.generated_toast.failed_to_request_invite')
            );
        }
    }

    async function sendFriendBoop(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        try {
            const result = await prompt({
                title: appI18n.t('component.friends_sidebar.generated_modal.send_boop'),
                description:
                    appI18n.t('component.friends_sidebar.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'),
                inputValue: '',
                confirmText: appI18n.t('component.friends_sidebar.generated_modal.send'),
                cancelText: appI18n.t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.sendBoop({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(t('side_panel.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('component.friends_sidebar.generated_toast.failed_to_send_boop')
            );
        }
    }

    async function saveCurrentUserPatch(
        patch,
        { successMessage, errorMessage }
    ) {
        if (!currentUserId) {
            toast.error(
                t('side_panel.generated.cannot_update_profile_no_current_user_session_is_available')
            );
            return;
        }
        try {
            const nextUser = await userProfileRepository.updateCurrentUser({
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: patch
            });
            if (nextUser?.id) {
                const previousUser =
                    useRuntimeStore.getState().auth.currentUserSnapshot;
                const mergedUser = mergeCurrentUserPresenceFields(
                    nextUser,
                    previousUser
                );
                useRuntimeStore.getState().setAuthBootstrap({
                    currentUserId: mergedUser.id,
                    currentUserDisplayName:
                        mergedUser.displayName || mergedUser.username || '',
                    currentUserSnapshot: mergedUser
                });
            }
            toast.success(successMessage);
        } catch (error) {
            toast.error(userFacingErrorMessage(error, errorMessage));
        }
    }

    async function changeCurrentUserStatus(status) {
        await saveCurrentUserPatch(
            { status },
            {
                successMessage: 'Social status updated.',
                errorMessage: 'Failed to update social status.'
            }
        );
    }

    async function setCurrentUserStatusDescription(statusDescription) {
        await saveCurrentUserPatch(
            { statusDescription },
            {
                successMessage: 'Status description updated.',
                errorMessage: 'Failed to update status description.'
            }
        );
    }

    async function editCurrentUserStatusDescription() {
        const result = await prompt({
            title: appI18n.t('component.friends_sidebar.generated_modal.edit_status_description'),
            inputValue: currentUser?.statusDescription || '',
            multiline: true,
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        await setCurrentUserStatusDescription(result.value);
    }

    async function applyCurrentUserStatusPreset(preset) {
        if (!preset?.status) {
            return;
        }
        const patch = { status: preset.status };
        if (Object.prototype.hasOwnProperty.call(preset, 'statusDescription')) {
            patch.statusDescription = preset.statusDescription || '';
        }
        await saveCurrentUserPatch(patch, {
            successMessage: 'Status updated.',
            errorMessage: 'Failed to update status.'
        });
    }

    const rowActions = {
        open: openFriend,
        launch: launchFriendLocation,
        selfInvite: selfInviteToFriendLocation,
        invite: sendFriendInvite,
        requestInvite: requestFriendInvite,
        boop: sendFriendBoop,
        changeStatus: changeCurrentUserStatus,
        setStatusDescription: setCurrentUserStatusDescription,
        editStatusDescription: editCurrentUserStatusDescription,
        applyStatusPreset: applyCurrentUserStatusPreset
    };

    function pushSection(nextRows, { id, title, count, open }) {
        nextRows.push({
            type: 'section',
            key: `section:${id}`,
            id,
            title,
            count,
            open
        });
    }

    function pushFriendRows(nextRows, sectionKey, sectionRows, options = {}) {
        for (const friend of sectionRows) {
            const friendId = normalizeId(friend?.id);
            nextRows.push({
                type: 'friend',
                key: `friend:${sectionKey}:${friendId}`,
                friend,
                isCurrentUser: Boolean(
                    options.isCurrentUser ||
                    friendId === normalizeId(currentUserId)
                ),
                isGroupByInstance: Boolean(options.isGroupByInstance)
            });
        }
    }

    function pushFavoriteRows(nextRows) {
        if (!prefs.isSidebarDivideByFriendGroup) {
            pushFriendRows(nextRows, 'favorites', favoriteRows);
            return;
        }
        for (const section of favoriteGroupSections) {
            nextRows.push({
                type: 'favorite-group-header',
                key: `favorite-group:${section.key}`,
                label: section.label,
                count: section.rows.length
            });
            pushFriendRows(nextRows, `favorites:${section.key}`, section.rows);
        }
    }

    const virtualRows = useMemo(() => {
        const nextRows = [];

        if (loadStatus === 'running' && !rows.length) {
            nextRows.push({
                type: 'message',
                key: 'message:loading',
                className: '',
                text: detail || 'Loading friends'
            });
        }

        pushSection(nextRows, {
            id: 'me',
            title: t('side_panel.me'),
            open: openGroups.me
        });
        if (openGroups.me) {
            if (currentUser) {
                const currentUserRow = buildCurrentUserPresenceView(
                    currentUser,
                    {
                        gameState,
                        gameLogDisabled: Boolean(prefs.gameLogDisabled)
                    }
                );
                pushFriendRows(
                    nextRows,
                    'me',
                    [
                        {
                            ...currentUserRow,
                            stateBucket:
                                resolveCurrentUserStateBucket(currentUserRow)
                        }
                    ],
                    { isCurrentUser: true }
                );
            } else {
                nextRows.push({
                    type: 'message',
                    key: 'message:me',
                    className: 'px-2 py-1',
                    text: 'No current user snapshot.'
                });
            }
        }

        const pushSameInstance = () => {
            if (!sameInstanceGroups.length) {
                return;
            }
            pushSection(nextRows, {
                id: 'sameInstance',
                title: t('side_panel.same_instance'),
                count: sameInstanceGroups.length,
                open: openGroups.sameInstance
            });
            if (openGroups.sameInstance) {
                sameInstanceGroups.forEach((group, index) => {
                    nextRows.push({
                        type: 'instance-header',
                        key: `instance:${group.location}:${index}`,
                        location: group.location,
                        count: group.rows.length
                    });
                    pushFriendRows(
                        nextRows,
                        `sameInstance:${group.location}:${index}`,
                        group.rows,
                        { isGroupByInstance: true }
                    );
                });
            }
        };
        const pushFavorites = () => {
            if (!favoriteRows.length) {
                return;
            }
            pushSection(nextRows, {
                id: 'favorites',
                title: t('side_panel.favorite'),
                count: favoriteRows.length,
                open: openGroups.favorites
            });
            if (openGroups.favorites) {
                pushFavoriteRows(nextRows);
            }
        };

        if (prefs.isSameInstanceAboveFavorites) {
            pushSameInstance();
            pushFavorites();
        } else {
            pushFavorites();
            pushSameInstance();
        }

        pushSection(nextRows, {
            id: 'online',
            title: t('side_panel.online'),
            count: onlineRows.length,
            open: openGroups.online
        });
        if (openGroups.online) {
            pushFriendRows(nextRows, 'online', onlineRows);
        }

        pushSection(nextRows, {
            id: 'active',
            title: t('side_panel.active'),
            count: activeRows.length,
            open: openGroups.active
        });
        if (openGroups.active) {
            pushFriendRows(nextRows, 'active', activeRows);
        }

        pushSection(nextRows, {
            id: 'offline',
            title: t('side_panel.offline'),
            count: offlineRows.length,
            open: openGroups.offline
        });
        if (openGroups.offline) {
            pushFriendRows(nextRows, 'offline', offlineRows);
        }

        if (!rows.length && loadStatus !== 'running') {
            nextRows.push({
                type: 'message',
                key: 'message:empty',
                className: 'mt-4',
                text: detail || 'No friend roster snapshot.'
            });
        }

        nextRows.push({ type: 'footer', key: 'footer' });
        return nextRows;
    }, [
        activeRows,
        currentUser,
        currentUserId,
        detail,
        favoriteGroupSections,
        favoriteRows,
        gameState,
        loadStatus,
        offlineRows,
        onlineRows,
        openGroups,
        prefs.gameLogDisabled,
        prefs.isSameInstanceAboveFavorites,
        prefs.isSidebarDivideByFriendGroup,
        rows.length,
        sameInstanceGroups,
        t
    ]);

    const { viewportRef, virtualItems, totalSize } = useVirtualSidebarRows(
        virtualRows,
        estimateFriendSidebarRowSize
    );
    const visibleLocationMetadataEntries = useMemo(
        () =>
            virtualItems
                .map((item) => buildSidebarLocationMetadataEntry(item.row))
                .filter(Boolean),
        [virtualItems]
    );
    const locationMetadataByKey = useLocationMetadataBatch(
        visibleLocationMetadataEntries,
        { endpoint: currentEndpoint }
    );

    const virtualRowContext = {
        ageGatedInstancesVisible,
        canInviteFromCurrentLocation,
        currentInviteLocation,
        currentUser,
        currentUserId,
        friendsMap,
        gameState,
        isDarkMode,
        locationMetadataByKey,
        onlineIdSet,
        randomUserColours,
        recentActionVersion,
        showInstanceIdInLocation,
        statusPresets,
        timeUnitLabels,
        trustColor
    };

    return (
        <div
            ref={viewportRef}
            className="relative h-full overflow-auto overflow-x-hidden"
        >
            <div className="px-1.5 py-2.5">
                <div
                    className="relative w-full"
                    style={{ height: `${totalSize}px` }}
                >
                    {virtualItems.map((item) => (
                        <div
                            key={item.key}
                            className="absolute top-0 left-0 w-full"
                            style={{ transform: `translateY(${item.start}px)` }}
                        >
                            <FriendsSidebarVirtualRow
                                row={item.row}
                                context={virtualRowContext}
                                rowActions={rowActions}
                                onOpenFriend={openFriend}
                                onToggleSection={toggleSection}
                                t={t}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
