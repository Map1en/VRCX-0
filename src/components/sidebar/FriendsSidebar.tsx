import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocationMetadataBatch } from '@/components/location/useLocationMetadata';
import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows';
import { mergeRosterFriendFacts } from '@/domain/friends/friendRosterFacts';
import { useCurrentInstancePresence } from '@/domain/presence/useCurrentInstancePresence';
import { useKnownUserFacts } from '@/domain/users/useKnownUser';
import { subscribeRecentActions } from '@/services/recentActionService';
import { checkCanInvite } from '@/shared/utils/invite';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

import {
    buildFavoriteCollectionFriendIdSet,
    buildFavoriteCollectionSameInstanceGroups,
    buildFavoriteCollectionSidebarVirtualRows
} from './friends-sidebar/favoriteCollectionSidebarRows';
import {
    buildFavoriteIdSet,
    buildSameInstanceGroups,
    normalizeLocationStatus,
    readFriendStatusSource,
    resolveCurrentInviteLocation,
    sortActiveRows,
    sortRows
} from './friends-sidebar/friendsSidebarModel';
import {
    buildSidebarLocationMetadataEntry,
    estimateFriendSidebarRowSize
} from './friends-sidebar/FriendsSidebarRows';
import { buildFriendsSidebarVirtualRows } from './friends-sidebar/friendsSidebarVirtualRowBuilder';
import { FriendsSidebarVirtualRow } from './friends-sidebar/FriendsSidebarVirtualRows';
import { useFriendsSidebarActions } from './friends-sidebar/useFriendsSidebarActions';
import { useFriendsSidebarPreferences } from './friends-sidebar/useFriendsSidebarPreferences';

const EMPTY_CURRENT_LOCATION_PLAYER_IDS = Object.freeze([]);

function useFriendsSidebarRuntimeSnapshot() {
    const themeMode = useShellStore((state: any) => state.themeMode);
    const currentUser = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state: any) => state.gameState.currentDestination
    );
    const currentLocationPlayerIds = useRuntimeStore(
        (state: any) => state.gameState.currentLocationPlayerIds
    );
    const domainCurrentInstancePresence = useCurrentInstancePresence();
    const isGameRunning = useRuntimeStore(
        (state: any) => state.gameState.isGameRunning
    );
    const effectiveCurrentLocationPlayerIds =
        currentLocationPlayerIds && currentLocationPlayerIds.length
            ? currentLocationPlayerIds
            : domainCurrentInstancePresence?.userIds ||
              EMPTY_CURRENT_LOCATION_PLAYER_IDS;
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            currentLocationPlayerIds: effectiveCurrentLocationPlayerIds,
            isGameRunning
        }),
        [
            effectiveCurrentLocationPlayerIds,
            isGameRunning,
            runtimeCurrentDestination,
            runtimeCurrentLocation
        ]
    );
    const currentLocation =
        runtimeCurrentLocation === 'traveling'
            ? runtimeCurrentDestination
            : runtimeCurrentLocation;
    const isDarkMode =
        themeMode === 'dark' ||
        (typeof document !== 'undefined' &&
            document.documentElement.classList.contains('dark'));

    return {
        currentEndpoint,
        currentLocation,
        currentUser,
        currentUserId,
        effectiveCurrentLocationPlayerIds,
        gameState,
        isDarkMode
    };
}

function useFriendsSidebarRosterState() {
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state: any) => state.orderedFriendIds
    );
    const onlineIds = useFriendRosterStore((state: any) => state.onlineIds);
    const activeIds = useFriendRosterStore((state: any) => state.activeIds);
    const offlineIds = useFriendRosterStore((state: any) => state.offlineIds);
    const loadStatus = useFriendRosterStore((state: any) => state.loadStatus);
    const factsById = useKnownUserFacts(orderedFriendIds);
    const mergedFriendsById = useMemo(
        () => mergeRosterFriendFacts(friendsById, factsById),
        [friendsById, factsById]
    );

    return {
        activeIds,
        friendsById: mergedFriendsById,
        loadStatus,
        offlineIds,
        onlineIds,
        orderedFriendIds
    };
}

function useFriendsSidebarFavoriteState() {
    const favoriteFriendIds = useFavoriteStore(
        (state: any) => state.favoriteFriendIds
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state: any) => state.favoriteFriendGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state: any) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localFriendFavorites = useFavoriteStore(
        (state: any) => state.localFriendFavorites
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state: any) => state.localFriendFavoriteGroups
    );

    return {
        favoriteFriendGroups,
        favoriteFriendIds,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites
    };
}

function useFriendsSidebarDisplayPreferences() {
    const randomUserColours = usePreferencesStore(
        (state: any) => state.randomUserColours
    );
    const trustColor = usePreferencesStore((state: any) => state.trustColor);
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const ageGatedInstancesVisiblePreference = usePreferencesStore(
        (state: any) => state.isAgeGatedInstancesVisible
    );
    const showInstanceIdInLocation = usePreferencesStore(
        (state: any) => state.showInstanceIdInLocation
    );
    const ageGatedInstancesVisible =
        preferencesHydrated && ageGatedInstancesVisiblePreference;

    return {
        ageGatedInstancesVisible,
        randomUserColours,
        showInstanceIdInLocation,
        trustColor
    };
}

export function FriendsSidebar({
    prefs,
    excludedFavoriteGroupKeys = [],
    favoriteCollectionTab = null
}: any) {
    const { t } = useTranslation();
    const {
        currentEndpoint,
        currentLocation,
        currentUser,
        currentUserId,
        effectiveCurrentLocationPlayerIds,
        gameState,
        isDarkMode
    } = useFriendsSidebarRuntimeSnapshot();
    const {
        activeIds,
        friendsById,
        loadStatus,
        offlineIds,
        onlineIds,
        orderedFriendIds
    } = useFriendsSidebarRosterState();
    const {
        favoriteFriendGroups,
        favoriteFriendIds,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites
    } = useFriendsSidebarFavoriteState();
    const confirm = useModalStore((state: any) => state.confirm);
    const prompt = useModalStore((state: any) => state.prompt);
    const {
        ageGatedInstancesVisible,
        randomUserColours,
        showInstanceIdInLocation,
        trustColor
    } = useFriendsSidebarDisplayPreferences();
    const { openGroups, statusPresets, toggleSection } =
        useFriendsSidebarPreferences();
    const [recentActionVersion, setRecentActionVersion] = useState(0);
    const sameInstanceFallbackJoinTimesRef = useRef(new Map());
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUser),
        [currentUser, gameState]
    );
    const currentLocationSnapshot = useMemo(
        () => ({
            location: currentLocation,
            friendList: new Set(
                Array.isArray(effectiveCurrentLocationPlayerIds)
                    ? effectiveCurrentLocationPlayerIds
                    : []
            )
        }),
        [currentLocation, effectiveCurrentLocationPlayerIds]
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
    const {
        applyCurrentUserStatusPreset,
        changeCurrentUserStatus,
        editCurrentUserStatusDescription,
        launchFriendLocation,
        openFriend,
        requestFriendInvite,
        selfInviteToFriendLocation,
        sendFriendBoop,
        sendFriendInvite,
        setCurrentUserStatusDescription
    } = useFriendsSidebarActions({
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
                setRecentActionVersion((version: any) => version + 1);
            }),
        []
    );

    const rows = useMemo(
        () =>
            orderedFriendIds.map((id: any) => friendsById[id]).filter(Boolean),
        [friendsById, orderedFriendIds]
    );
    const favoriteIds = useMemo(
        () => buildFavoriteIdSet(favoriteFriendIds, localFriendFavorites),
        [favoriteFriendIds, localFriendFavorites]
    );
    const favoriteCollectionIdSet = useMemo(() => {
        if (!favoriteCollectionTab) {
            return null;
        }
        return buildFavoriteCollectionFriendIdSet({
            sourceGroupKeys: favoriteCollectionTab.sourceGroupKeys,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavorites
        });
    }, [
        favoriteCollectionTab,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavorites
    ]);
    const favoriteCollectionRows = useMemo(() => {
        if (!favoriteCollectionIdSet) {
            return [];
        }
        return sortRows(
            rows.filter((friend: any) =>
                favoriteCollectionIdSet.has(normalizeId(friend?.id))
            ),
            prefs
        );
    }, [favoriteCollectionIdSet, prefs, rows]);
    const allFavoriteGroupKeys = useMemo(
        () => [
            ...(favoriteFriendGroups || [])
                .map((group: any) => group.key)
                .filter(Boolean),
            ...(localFriendFavoriteGroups?.length
                ? localFriendFavoriteGroups
                : Object.keys(localFriendFavorites || {})
            ).map((groupName: any) => `local:${groupName}`)
        ],
        [favoriteFriendGroups, localFriendFavoriteGroups, localFriendFavorites]
    );
    const excludedFavoriteGroupKeySet = useMemo(
        () =>
            new Set<string>(
                (excludedFavoriteGroupKeys || [])
                    .map((key: any) => normalizeId(key))
                    .filter(Boolean)
            ),
        [excludedFavoriteGroupKeys]
    );
    const selectedFavoriteGroupKeys = useMemo(() => {
        const configured = Array.isArray(prefs.sidebarFavoriteGroups)
            ? prefs.sidebarFavoriteGroups.filter(Boolean)
            : [];
        const removeExcluded = (keys: any) =>
            keys.filter((key: any) => !excludedFavoriteGroupKeySet.has(key));
        if (!configured.length) {
            return new Set<string>(removeExcluded(allFavoriteGroupKeys));
        }
        return new Set<string>(removeExcluded(configured));
    }, [
        allFavoriteGroupKeys,
        excludedFavoriteGroupKeySet,
        prefs.sidebarFavoriteGroups
    ]);
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
    const excludedFavoriteIds = excludedFavoriteGroupKeySet.size
        ? selectedFavoriteIds
        : hasFavoriteGroupFilter
          ? selectedFavoriteIds
          : favoriteIds;
    const sameInstanceGroups = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        if (!prefs.sidebarGroupByInstance) {
            return [];
        }
        return buildSameInstanceGroups(
            rows,
            prefs,
            currentLocationSnapshot,
            sameInstanceFallbackJoinTimesRef.current
        );
    }, [currentLocationSnapshot, favoriteCollectionTab, prefs, rows]);
    const favoriteCollectionSameInstanceGroups = useMemo(() => {
        if (!favoriteCollectionTab) {
            return [];
        }
        return buildFavoriteCollectionSameInstanceGroups({
            rows: favoriteCollectionRows,
            prefs,
            currentLocationSnapshot,
            fallbackJoinTimes: sameInstanceFallbackJoinTimesRef.current
        });
    }, [
        currentLocationSnapshot,
        favoriteCollectionRows,
        favoriteCollectionTab,
        prefs
    ]);
    const favoriteCollectionSameInstanceIds = useMemo(
        () =>
            new Set(
                favoriteCollectionSameInstanceGroups.flatMap((group: any) =>
                    group.rows.map((friend: any) => friend.id)
                )
            ),
        [favoriteCollectionSameInstanceGroups]
    );
    const favoriteCollectionOnlineRows = useMemo(() => {
        if (!favoriteCollectionIdSet) {
            return [];
        }
        return sortRows(
            onlineIds
                .map((id: any) => friendsById[id])
                .filter(
                    (friend: any) =>
                        friend &&
                        favoriteCollectionIdSet.has(normalizeId(friend.id)) &&
                        !favoriteCollectionSameInstanceIds.has(friend.id)
                ),
            prefs
        );
    }, [
        favoriteCollectionIdSet,
        favoriteCollectionSameInstanceIds,
        friendsById,
        onlineIds,
        prefs
    ]);
    const favoriteCollectionActiveRows = useMemo(() => {
        if (!favoriteCollectionIdSet) {
            return [];
        }
        return sortActiveRows(
            activeIds
                .map((id: any) => friendsById[id])
                .filter(
                    (friend: any) =>
                        friend &&
                        favoriteCollectionIdSet.has(normalizeId(friend.id))
                ),
            prefs
        );
    }, [activeIds, favoriteCollectionIdSet, friendsById, prefs]);
    const favoriteCollectionOfflineRows = useMemo(() => {
        if (!favoriteCollectionIdSet) {
            return [];
        }
        return sortRows(
            offlineIds
                .map((id: any) => friendsById[id])
                .filter(
                    (friend: any) =>
                        friend &&
                        favoriteCollectionIdSet.has(normalizeId(friend.id))
                ),
            prefs
        );
    }, [favoriteCollectionIdSet, friendsById, offlineIds, prefs]);
    const sameInstanceIds = useMemo(
        () =>
            new Set(
                sameInstanceGroups.flatMap((group: any) =>
                    group.rows.map((friend: any) => friend.id)
                )
            ),
        [sameInstanceGroups]
    );
    const onlineIdSet = useMemo(() => new Set(onlineIds), [onlineIds]);
    const favoriteRows = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        return sortRows(
            rows.filter((friend: any) => {
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
        );
    }, [
        favoriteCollectionTab,
        prefs,
        rows,
        sameInstanceIds,
        selectedFavoriteIds
    ]);
    const onlineRows = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        return sortRows(
            onlineIds
                .map((id: any) => friendsById[id])
                .filter(
                    (friend: any) =>
                        friend &&
                        !excludedFavoriteIds.has(normalizeId(friend.id)) &&
                        !(
                            prefs.isHideFriendsInSameInstance &&
                            sameInstanceIds.has(friend.id)
                        )
                ),
            prefs
        );
    }, [
        excludedFavoriteIds,
        favoriteCollectionTab,
        friendsById,
        onlineIds,
        prefs,
        sameInstanceIds
    ]);
    const activeRows = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        return sortActiveRows(
            activeIds.map((id: any) => friendsById[id]).filter(Boolean),
            prefs
        );
    }, [activeIds, favoriteCollectionTab, friendsById, prefs]);
    const offlineRows = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        return sortRows(
            offlineIds.map((id: any) => friendsById[id]).filter(Boolean),
            prefs
        );
    }, [favoriteCollectionTab, offlineIds, friendsById, prefs]);
    const favoriteGroupSections = useMemo(() => {
        if (!prefs.isSidebarDivideByFriendGroup) {
            return [];
        }
        const favoriteRowById = new Map(
            favoriteRows.map((friend: any) => [normalizeId(friend.id), friend])
        );
        const seen = new Set();
        const sections = [];

        const orderedRemoteGroups = [...(favoriteFriendGroups || [])].sort(
            (left: any, right: any) => {
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
        ].sort((left: any, right: any) => {
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
                .map((id: any) => favoriteRowById.get(normalizeId(id)))
                .filter(Boolean);
            if (rowsForGroup.length) {
                rowsForGroup.forEach((friend: any) =>
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
                .map((id: any) => favoriteRowById.get(normalizeId(id)))
                .filter(Boolean);
            if (rowsForGroup.length) {
                rowsForGroup.forEach((friend: any) =>
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
            (friend: any) => !seen.has(normalizeId(friend.id))
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
        if (favoriteCollectionTab) {
            return buildFavoriteCollectionSidebarVirtualRows({
                activeRows: favoriteCollectionActiveRows,
                currentUserId,
                emptyText: t(
                    'side_panel.settings.custom_tabs.empty_favorite_collection'
                ),
                loadStatus,
                offlineRows: favoriteCollectionOfflineRows,
                onlineRows: favoriteCollectionOnlineRows,
                openGroups,
                rowsLength: favoriteCollectionRows.length,
                sameInstanceGroups: favoriteCollectionSameInstanceGroups,
                t
            });
        }
        return buildFriendsSidebarVirtualRows({
            activeRows,
            currentUser,
            currentUserId,
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
        favoriteGroupSections,
        favoriteCollectionActiveRows,
        favoriteCollectionOfflineRows,
        favoriteCollectionOnlineRows,
        favoriteCollectionRows.length,
        favoriteCollectionSameInstanceGroups,
        favoriteCollectionTab,
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

    const { getRowRef, viewportRef, virtualItems, totalSize } =
        useVirtualSidebarRows(virtualRows, estimateFriendSidebarRowSize);
    const visibleLocationMetadataEntries = useMemo(
        () =>
            virtualItems
                .map((item: any) => item.row)
                .map((row: any) => buildSidebarLocationMetadataEntry(row))
                .filter(Boolean),
        [virtualItems]
    );
    const locationMetadataByKey = useLocationMetadataBatch(
        visibleLocationMetadataEntries,
        { endpoint: currentEndpoint }
    );
    const runtimeView = {
        canInviteFromCurrentLocation,
        currentInviteLocation,
        currentUser,
        currentUserId,
        friendsMap,
        gameState,
        onlineIdSet
    };
    const appearanceView = {
        ageGatedInstancesVisible,
        isDarkMode,
        randomUserColours,
        recentActionVersion,
        showInstanceIdInLocation,
        trustColor
    };
    const locationView = {
        locationMetadataByKey
    };
    const friendRowCommands = {
        onOpenFriend: openFriend,
        onToggleSection: toggleSection,
        onLaunch: launchFriendLocation,
        onSelfInvite: selfInviteToFriendLocation,
        onInvite: sendFriendInvite,
        onRequestInvite: requestFriendInvite,
        onBoop: sendFriendBoop
    };
    const statusCommands = {
        statusPresets,
        onChangeStatus: changeCurrentUserStatus,
        onSetStatusDescription: setCurrentUserStatusDescription,
        onEditStatusDescription: editCurrentUserStatusDescription,
        onApplyStatusPreset: applyCurrentUserStatusPreset
    };

    return (
        <div
            ref={viewportRef}
            className="relative h-full overflow-auto overflow-x-hidden"
        >
            <div className="px-1.5 pb-2.5">
                <div
                    className="relative w-full"
                    style={{ height: `${totalSize}px` }}
                >
                    {virtualItems.map((item: any) => (
                        <div
                            key={item.key}
                            ref={getRowRef(item.key)}
                            className="absolute top-0 left-0 w-full"
                            style={{ transform: `translateY(${item.start}px)` }}
                        >
                            <FriendsSidebarVirtualRow
                                row={item.row}
                                isFirstRow={item.index === 0}
                                appearance={appearanceView}
                                friendCommands={friendRowCommands}
                                location={locationView}
                                runtime={runtimeView}
                                statusCommands={statusCommands}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
