import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CurrentUserSocialStatusDialog } from '@/components/dialogs/user-dialog/UserSelfEditDialogs';
import { useLocationMetadataBatch } from '@/components/location/useLocationMetadata';
import { handleSidebarRowArrowNavigation } from '@/components/sidebar/sidebarRowArrowNavigation';
import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows';
import {
    collectFavoriteGroupFriendIds,
    resolveSelectedFavoriteGroupKeys
} from '@/domain/favorites/favoriteGroupSelection';
import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import type { FavoriteGroup } from '@/domain/favorites/types';
import {
    presenceLiveInstanceTag,
    presenceSection
} from '@/domain/friends/presence';
import {
    resolveObservedPlayerUserIds,
    type SameInstanceLastLocation
} from '@/domain/friends/sameInstanceFriends';
import type { FriendRecord, FriendRosterById } from '@/domain/friends/types';
import { useCurrentInviteContext } from '@/lib/useCurrentInviteContext';
import { useFriendSortContext } from '@/lib/useFriendStats';
import { subscribeRecentActions } from '@/services/recentActionService';
import {
    buildLocalInstanceActionGateMap,
    evaluateLocalInstanceActionGates,
    type LocalInstanceActionGateTarget
} from '@/shared/utils/invite';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useModalStore } from '@/state/modalStore';

import {
    buildFavoriteCollectionFriendIdSet,
    buildFavoriteCollectionSameInstanceGroups,
    buildFavoriteCollectionSidebarVirtualRows
} from './friends-sidebar/favoriteCollectionSidebarRows';
import {
    buildSameInstanceGroups,
    friendMatchesSidebarFilterQuery,
    normalizeSidebarFilterQuery,
    sortActiveRows,
    sortRows,
    type SidebarFriendRecord,
    type SidebarPreferences
} from './friends-sidebar/friendsSidebarModel';
import {
    buildSidebarLocationMetadataEntry,
    estimateFriendSidebarRowSize
} from './friends-sidebar/FriendsSidebarRows';
import {
    buildFriendsSidebarVirtualRows,
    type SidebarVirtualRow
} from './friends-sidebar/friendsSidebarVirtualRowBuilder';
import { FriendsSidebarVirtualRow } from './friends-sidebar/FriendsSidebarVirtualRows';
import { useFriendsSidebarActions } from './friends-sidebar/useFriendsSidebarActions';
import { useFriendsSidebarPreferences } from './friends-sidebar/useFriendsSidebarPreferences';
import { useFriendsSidebarDisplayPreferences } from './useFriendsSidebarDisplayPreferences';
import { useFriendsSidebarFavoriteState } from './useFriendsSidebarFavoriteState';
import { useFriendsSidebarRosterState } from './useFriendsSidebarRosterState';
import { useFriendsSidebarRuntimeSnapshot } from './useFriendsSidebarRuntimeSnapshot';

function hasFavoriteGroupKey(
    group: FavoriteGroup
): group is FavoriteGroup & { key: string } {
    return typeof group.key === 'string' && group.key.length > 0;
}

type FavoriteCollectionTab = {
    id?: string;
    sourceGroupKeys?: string[];
};

type FriendsSidebarProps = {
    prefs: SidebarPreferences;
    favoriteCollectionTab?: FavoriteCollectionTab | null;
    filterQuery?: string;
};

type FavoriteGroupSection = {
    key: string;
    label: string;
    rows: readonly SidebarFriendRecord[];
};

function isPresent<T>(value: T | null | undefined): value is T {
    return value != null;
}

function rowsByIds(ids: readonly string[], friendsById: FriendRosterById) {
    return ids.map((id) => friendsById[id]).filter(isPresent);
}

function filterIdsByQuery(
    ids: readonly string[],
    friendsById: FriendRosterById,
    query: string
) {
    if (!query) {
        return ids;
    }
    return ids.filter((id) => {
        const friend = friendsById[id];
        return friend && friendMatchesSidebarFilterQuery(friend, query);
    });
}

function buildInstanceActionGateTarget(
    friend: FriendRecord,
    currentUserId?: string | null
): LocalInstanceActionGateTarget {
    return {
        key: friend.id,
        userId: friend.id,
        location: presenceLiveInstanceTag(friend.$presence, {
            preferTraveling: false
        }),
        presenceKind: friend.$presence.kind,
        isCurrentUser: friend.id === normalizeId(currentUserId)
    };
}

export function FriendsSidebar({
    prefs,
    favoriteCollectionTab = null,
    filterQuery = ''
}: FriendsSidebarProps) {
    const { t } = useTranslation();
    const {
        currentEndpoint,
        currentUser,
        currentUserId,
        currentLocationPlayers,
        effectiveCurrentLocationPlayerIds,
        gameState,
        isDarkMode
    } = useFriendsSidebarRuntimeSnapshot();
    const {
        activeIds: allActiveIds,
        friendsById,
        loadStatus,
        offlineIds: allOfflineIds,
        onlineIds,
        orderedFriendIds
    } = useFriendsSidebarRosterState();
    const filterText = normalizeSidebarFilterQuery(filterQuery);
    const visibleOnlineIds = useMemo(
        () => filterIdsByQuery(onlineIds, friendsById, filterText),
        [filterText, friendsById, onlineIds]
    );
    const activeIds = useMemo(
        () => filterIdsByQuery(allActiveIds, friendsById, filterText),
        [allActiveIds, filterText, friendsById]
    );
    const offlineIds = useMemo(
        () => filterIdsByQuery(allOfflineIds, friendsById, filterText),
        [allOfflineIds, filterText, friendsById]
    );
    const locationTimesByUserId = useFriendLocationTimeStore(
        (state) => state.byUserId
    );
    const sortContext = useFriendSortContext(
        [
            prefs.sidebarSortMethod1,
            prefs.sidebarSortMethod2,
            prefs.sidebarSortMethod3
        ],
        locationTimesByUserId
    );
    const {
        favoriteFriendGroups,
        favoriteFriendIds,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites
    } = useFriendsSidebarFavoriteState();
    const confirm = useModalStore((state) => state.confirm);
    const {
        ageGatedInstancesVisible,
        randomUserColours,
        randomUserColourStyle,
        showInstanceIdInLocation,
        showSidebarAvatarFrame,
        showSidebarNameplate,
        trustColor
    } = useFriendsSidebarDisplayPreferences();
    const { openGroups, statusPresets, toggleSection } =
        useFriendsSidebarPreferences();
    const [recentActionVersion, setRecentActionVersion] = useState(0);
    const {
        currentLocation,
        currentInviteLocation,
        canInviteFromCurrentLocation
    } = useCurrentInviteContext();
    const currentLocationSnapshot = useMemo<SameInstanceLastLocation>(
        () => ({
            location: currentLocation,
            friendList: new Set(
                resolveObservedPlayerUserIds(
                    effectiveCurrentLocationPlayerIds,
                    currentLocationPlayers,
                    friendsById
                )
            )
        }),
        [
            currentLocation,
            currentLocationPlayers,
            effectiveCurrentLocationPlayerIds,
            friendsById
        ]
    );
    const {
        applyCurrentUserStatusPreset,
        changeCurrentUserStatus,
        editCurrentUserSocialStatus,
        openFriend,
        requestFriendInvite,
        selfInviteToFriendLocation,
        sendFriendBoop,
        sendFriendInvite,
        setCurrentUserStatusDescription,
        socialStatusDialog
    } = useFriendsSidebarActions({
        canInviteFromCurrentLocation,
        confirm,
        currentInviteLocation,
        currentUser,
        currentUserId
    });

    useEffect(
        () =>
            subscribeRecentActions(() => {
                setRecentActionVersion((version) => version + 1);
            }),
        []
    );

    const rows = useMemo(
        () =>
            rowsByIds(
                filterIdsByQuery(orderedFriendIds, friendsById, filterText),
                friendsById
            ),
        [filterText, friendsById, orderedFriendIds]
    );
    const instanceActionGateTargets = useMemo(
        () =>
            rows.map((friend) =>
                buildInstanceActionGateTarget(friend, currentUserId)
            ),
        [currentUserId, rows]
    );
    const instanceActionGatesByUserId = useMemo(
        () =>
            buildLocalInstanceActionGateMap(
                evaluateLocalInstanceActionGates({
                    currentUserId,
                    currentInviteLocation,
                    isGameRunning: Boolean(gameState.isGameRunning),
                    friendUserIds: Object.keys(friendsById || {}),
                    targets: instanceActionGateTargets
                }).targets
            ),
        [
            currentInviteLocation,
            currentUserId,
            friendsById,
            gameState.isGameRunning,
            instanceActionGateTargets
        ]
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
            rows.filter((friend) =>
                favoriteCollectionIdSet.has(normalizeId(friend?.id))
            ),
            prefs,
            sortContext
        );
    }, [favoriteCollectionIdSet, prefs, rows, sortContext]);
    const allFavoriteGroupKeys = useMemo(
        () => [
            ...(favoriteFriendGroups || [])
                .map((group) => group.key)
                .filter((key): key is string => Boolean(key)),
            ...(localFriendFavoriteGroups?.length
                ? localFriendFavoriteGroups
                : Object.keys(localFriendFavorites || {})
            ).map((groupName) => `local:${groupName}`)
        ],
        [favoriteFriendGroups, localFriendFavoriteGroups, localFriendFavorites]
    );
    const hasFavoriteGroupFilter = useMemo(
        () =>
            Array.isArray(prefs.sidebarFavoriteGroups) &&
            prefs.sidebarFavoriteGroups.length > 0,
        [prefs.sidebarFavoriteGroups]
    );
    const selectedFavoriteGroupKeys = useMemo(
        () =>
            new Set(
                resolveSelectedFavoriteGroupKeys(
                    prefs.sidebarFavoriteGroups,
                    allFavoriteGroupKeys
                )
            ),
        [allFavoriteGroupKeys, prefs.sidebarFavoriteGroups]
    );
    const selectedFavoriteIds = useMemo(
        () =>
            allFavoriteGroupKeys.length
                ? collectFavoriteGroupFriendIds(
                      selectedFavoriteGroupKeys,
                      groupedFavoriteFriendIdsByGroupKey,
                      localFriendFavorites
                  )
                : favoriteIds,
        [
            allFavoriteGroupKeys,
            favoriteIds,
            groupedFavoriteFriendIdsByGroupKey,
            localFriendFavorites,
            selectedFavoriteGroupKeys
        ]
    );
    const excludedFavoriteIds = hasFavoriteGroupFilter
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
            locationTimesByUserId,
            sortContext
        );
    }, [
        sortContext,
        currentLocationSnapshot,
        favoriteCollectionTab,
        locationTimesByUserId,
        prefs,
        rows
    ]);
    const favoriteCollectionSameInstanceGroups = useMemo(() => {
        if (!favoriteCollectionTab) {
            return [];
        }
        return buildFavoriteCollectionSameInstanceGroups({
            rows: favoriteCollectionRows,
            prefs,
            currentLocationSnapshot,
            locationTimes: locationTimesByUserId,
            sortContext
        });
    }, [
        sortContext,
        currentLocationSnapshot,
        favoriteCollectionRows,
        favoriteCollectionTab,
        locationTimesByUserId,
        prefs
    ]);
    const favoriteCollectionSameInstanceIds = useMemo(
        () =>
            new Set(
                prefs.isHideFriendsInSameInstance
                    ? favoriteCollectionSameInstanceGroups.flatMap((group) =>
                          group.rows.map((friend) => friend.id)
                      )
                    : []
            ),
        [
            favoriteCollectionSameInstanceGroups,
            prefs.isHideFriendsInSameInstance
        ]
    );
    const favoriteCollectionOnlineRows = useMemo(() => {
        if (!favoriteCollectionIdSet) {
            return [];
        }
        return sortRows(
            rowsByIds(visibleOnlineIds, friendsById).filter(
                (friend) =>
                    favoriteCollectionIdSet.has(normalizeId(friend.id)) &&
                    !favoriteCollectionSameInstanceIds.has(friend.id)
            ),
            prefs,
            sortContext
        );
    }, [
        favoriteCollectionIdSet,
        favoriteCollectionSameInstanceIds,
        friendsById,
        prefs,
        visibleOnlineIds,
        sortContext
    ]);
    const favoriteCollectionActiveRows = useMemo(() => {
        if (!favoriteCollectionIdSet) {
            return [];
        }
        return sortActiveRows(
            rowsByIds(activeIds, friendsById).filter(
                (friend) =>
                    favoriteCollectionIdSet.has(normalizeId(friend.id)) &&
                    !favoriteCollectionSameInstanceIds.has(friend.id)
            ),
            prefs,
            sortContext
        );
    }, [
        activeIds,
        favoriteCollectionIdSet,
        favoriteCollectionSameInstanceIds,
        friendsById,
        prefs,
        sortContext
    ]);
    const favoriteCollectionOfflineRows = useMemo(() => {
        if (!favoriteCollectionIdSet) {
            return [];
        }
        return sortRows(
            rowsByIds(offlineIds, friendsById).filter(
                (friend) =>
                    favoriteCollectionIdSet.has(normalizeId(friend.id)) &&
                    !favoriteCollectionSameInstanceIds.has(friend.id)
            ),
            prefs,
            sortContext
        );
    }, [
        favoriteCollectionIdSet,
        favoriteCollectionSameInstanceIds,
        friendsById,
        offlineIds,
        prefs,
        sortContext
    ]);
    const sameInstanceIds = useMemo(
        () =>
            new Set(
                sameInstanceGroups.flatMap((group) =>
                    group.rows.map((friend) => friend.id)
                )
            ),
        [sameInstanceGroups]
    );
    const favoriteRows = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        return sortRows(
            rows.filter((friend) => {
                return (
                    selectedFavoriteIds.has(normalizeId(friend?.id)) &&
                    presenceSection(friend.$presence) === 'online' &&
                    !(
                        prefs.isHideFriendsInSameInstance &&
                        sameInstanceIds.has(friend.id)
                    )
                );
            }),
            prefs,
            sortContext
        );
    }, [
        favoriteCollectionTab,
        prefs,
        rows,
        sameInstanceIds,
        selectedFavoriteIds,
        sortContext
    ]);
    const onlineRows = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        return sortRows(
            rowsByIds(visibleOnlineIds, friendsById).filter(
                (friend) =>
                    !excludedFavoriteIds.has(normalizeId(friend.id)) &&
                    !(
                        prefs.isHideFriendsInSameInstance &&
                        sameInstanceIds.has(friend.id)
                    )
            ),
            prefs,
            sortContext
        );
    }, [
        excludedFavoriteIds,
        favoriteCollectionTab,
        friendsById,
        prefs,
        sameInstanceIds,
        visibleOnlineIds,
        sortContext
    ]);
    const activeRows = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        return sortActiveRows(
            rowsByIds(activeIds, friendsById).filter(
                (friend) =>
                    !(
                        prefs.isHideFriendsInSameInstance &&
                        sameInstanceIds.has(friend.id)
                    )
            ),
            prefs,
            sortContext
        );
    }, [
        activeIds,
        favoriteCollectionTab,
        friendsById,
        prefs,
        sameInstanceIds,
        sortContext
    ]);
    const offlineRows = useMemo(() => {
        if (favoriteCollectionTab) {
            return [];
        }
        return sortRows(
            rowsByIds(offlineIds, friendsById).filter(
                (friend) =>
                    !(
                        prefs.isHideFriendsInSameInstance &&
                        sameInstanceIds.has(friend.id)
                    )
            ),
            prefs,
            sortContext
        );
    }, [
        favoriteCollectionTab,
        offlineIds,
        friendsById,
        prefs,
        sameInstanceIds,
        sortContext
    ]);
    const favoriteGroupSections = useMemo(() => {
        if (!prefs.isSidebarDivideByFriendGroup) {
            return [];
        }
        const favoriteRowById = new Map<string, FriendRecord>(
            favoriteRows.map((friend) => [normalizeId(friend.id), friend])
        );
        const seen = new Set<string>();
        const sections: FavoriteGroupSection[] = [];

        const orderedRemoteGroups = [...(favoriteFriendGroups || [])]
            .filter(hasFavoriteGroupKey)
            .sort((left, right) => {
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
            });
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
            return 0;
        });

        for (const group of orderedRemoteGroups) {
            if (!selectedFavoriteGroupKeys.has(group.key)) {
                continue;
            }
            const rowsForGroup = (
                groupedFavoriteFriendIdsByGroupKey?.[group.key] || []
            )
                .map((id) => favoriteRowById.get(normalizeId(id)))
                .filter(isPresent);
            if (rowsForGroup.length) {
                rowsForGroup.forEach((friend) =>
                    seen.add(normalizeId(friend.id))
                );
                sections.push({
                    key: group.key,
                    label: group.displayName || group.name || group.key,
                    rows: sortRows(rowsForGroup, prefs, sortContext)
                });
            }
        }

        for (const groupName of orderedLocalGroups) {
            if (!selectedFavoriteGroupKeys.has(`local:${groupName}`)) {
                continue;
            }
            const rowsForGroup = (localFriendFavorites?.[groupName] || [])
                .map((id) => favoriteRowById.get(normalizeId(id)))
                .filter(isPresent);
            if (rowsForGroup.length) {
                rowsForGroup.forEach((friend) =>
                    seen.add(normalizeId(friend.id))
                );
                sections.push({
                    key: `local:${groupName}`,
                    label: groupName,
                    rows: sortRows(rowsForGroup, prefs, sortContext)
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
        t,
        sortContext
    ]);

    const virtualRows = useMemo<SidebarVirtualRow[]>(() => {
        const filteredRowsLength = favoriteCollectionTab
            ? favoriteCollectionRows.length
            : rows.length;
        if (filterText && !filteredRowsLength) {
            return [
                {
                    type: 'message',
                    key: 'message:filter-empty',
                    text: t('side_panel.filter_no_results')
                },
                { type: 'footer', key: 'footer' }
            ];
        }
        if (favoriteCollectionTab) {
            return buildFavoriteCollectionSidebarVirtualRows({
                activeRows: favoriteCollectionActiveRows,
                currentUserId: currentUserId || '',
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
        filterText,
        loadStatus,
        offlineRows,
        onlineRows,
        openGroups,
        prefs,
        rows.length,
        sameInstanceGroups,
        t
    ]);

    const { getRowRef, viewportRef, virtualItems, totalSize } =
        useVirtualSidebarRows(virtualRows, estimateFriendSidebarRowSize);
    const visibleLocationMetadataEntries = useMemo(
        () =>
            virtualItems
                .map((item) => item.row)
                .map((row) =>
                    buildSidebarLocationMetadataEntry(
                        row,
                        locationTimesByUserId
                    )
                )
                .filter(Boolean),
        [locationTimesByUserId, virtualItems]
    );
    const locationMetadataByKey = useLocationMetadataBatch(
        visibleLocationMetadataEntries,
        { endpoint: currentEndpoint }
    );
    const runtimeView = {
        currentUser,
        currentUserId,
        gameState,
        instanceActionGatesByUserId
    };
    const appearanceView = {
        ageGatedInstancesVisible,
        isDarkMode,
        randomUserColours,
        randomUserColourStyle,
        recentActionVersion,
        showInstanceIdInLocation,
        showSidebarAvatarFrame,
        showSidebarNameplate,
        trustColor
    };
    const locationView = {
        locationMetadataByKey,
        locationTimesByUserId
    };
    const friendRowCommands = {
        onOpenFriend: openFriend,
        onToggleSection: toggleSection,
        onSelfInvite: selfInviteToFriendLocation,
        onInvite: sendFriendInvite,
        onRequestInvite: requestFriendInvite,
        onBoop: sendFriendBoop
    };
    const statusCommands = {
        statusPresets,
        onChangeStatus: changeCurrentUserStatus,
        onSetStatusDescription: setCurrentUserStatusDescription,
        onEditSocialStatus: editCurrentUserSocialStatus,
        onApplyStatusPreset: applyCurrentUserStatusPreset
    };

    return (
        <>
            <div
                ref={viewportRef}
                role="presentation"
                className="relative h-full overflow-auto overflow-x-hidden"
                onKeyDown={handleSidebarRowArrowNavigation}
            >
                <div className="px-1.5 pt-1 pb-2.5">
                    <div
                        className="relative w-full"
                        style={{ height: `${totalSize}px` }}
                    >
                        {virtualItems.map((item) => (
                            <div
                                key={String(item.key)}
                                ref={getRowRef(item.key)}
                                data-sidebar-row=""
                                className="absolute top-0 left-0 w-full"
                                style={{
                                    transform: `translateY(${item.start}px)`
                                }}
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
            <CurrentUserSocialStatusDialog controller={socialStatusDialog} />
        </>
    );
}
