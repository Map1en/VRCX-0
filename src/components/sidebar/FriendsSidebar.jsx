import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocationMetadataBatch } from '@/components/location/useLocationMetadata.js';
import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows.js';
import { subscribeRecentActions } from '@/services/recentActionService.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';

import {
    buildFavoriteIdSet,
    buildSameInstanceGroups,
    normalizeLocationStatus,
    normalizeId,
    readFriendStatusSource,
    resolveCurrentInviteLocation,
    sortRows
} from './friends-sidebar/friendsSidebarModel.js';
import {
    buildSidebarLocationMetadataEntry,
    estimateFriendSidebarRowSize
} from './friends-sidebar/FriendsSidebarRows.jsx';
import { buildFriendsSidebarVirtualRows } from './friends-sidebar/friendsSidebarVirtualRows.js';
import { FriendsSidebarVirtualRow } from './friends-sidebar/FriendsSidebarVirtualRows.jsx';
import { useFriendsSidebarActions } from './friends-sidebar/useFriendsSidebarActions.js';
import { useFriendsSidebarPreferences } from './friends-sidebar/useFriendsSidebarPreferences.js';
export function FriendsSidebar({ prefs }) {
    const { t } = useTranslation();
    const themeMode = useShellStore((state) => state.themeMode);
    const timeUnitLabels = useShellStore((state) => state.timeUnitLabels);
    const currentUser = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const currentLocationPlayerIds = useRuntimeStore(
        (state) => state.gameState.currentLocationPlayerIds
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            currentLocationPlayerIds,
            isGameRunning
        }),
        [
            currentLocationPlayerIds,
            isGameRunning,
            runtimeCurrentDestination,
            runtimeCurrentLocation
        ]
    );
    const currentLocation =
        runtimeCurrentLocation === 'traveling'
            ? runtimeCurrentDestination
            : runtimeCurrentLocation;
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
    const { openGroups, statusPresets, toggleSection } =
        useFriendsSidebarPreferences();
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
    const { openFriend, rowActions } = useFriendsSidebarActions({
        canInviteFromCurrentLocation,
        confirm,
        currentEndpoint,
        currentInviteLocation,
        currentUser,
        currentUserId,
        prompt
    });

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

    const virtualRows = useMemo(() => {
        return buildFriendsSidebarVirtualRows({
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
            prefs,
            rowsLength: rows.length,
            sameInstanceGroups,
            t
        });
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
