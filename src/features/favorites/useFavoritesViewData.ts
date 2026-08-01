import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeFavoriteSearchValue as normalizeSearchValue } from './favoritesItems';
import {
    buildFavoriteAvatarHistoryGroups,
    buildFavoriteAvatarHistoryItems,
    buildFavoriteGroupLabelByKey,
    buildFavoriteLocalGroups,
    buildFavoriteLocalItemsByGroup,
    buildFavoriteRemoteGroups,
    buildFavoriteRemoteItemsByGroup,
    getFavoritesPageConfig,
    type FavoriteEntityDetail
} from './favoritesPageData';
import type { FavoriteItem } from './favoritesTypes';
import type { FavoriteKind, FavoriteSource } from './favoritesTypes';
import type { useFavoritesCollectionsState } from './useFavoritesCollectionsState';

const EMPTY_ITEMS: FavoriteItem[] = [];

function isFavoriteEntityDetail(value: unknown): value is FavoriteEntityDetail {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeFavoriteDetailMap(
    value: Record<string, unknown> | undefined
): Record<string, FavoriteEntityDetail | undefined> {
    const details: Record<string, FavoriteEntityDetail | undefined> = {};
    for (const [id, detail] of Object.entries(value || {})) {
        if (isFavoriteEntityDetail(detail)) {
            details[id] = detail;
        }
    }
    return details;
}

type FavoritesViewDataInputs = ReturnType<
    typeof useFavoritesCollectionsState
>['viewDataInputs'] & {
    kind: FavoriteKind;
    searchMode: string;
    searchQuery: string;
    selectedGroupKey: string;
    selectedSource: FavoriteSource;
    sortValue: string;
};

export function useFavoritesViewData({
    avatarHistory,
    favoriteAvatarGroups,
    favoriteFriendGroups,
    favoriteWorldGroups,
    favoritesSortOrder,
    friendsById,
    groupedFavoriteFriendIdsByGroupKey,
    knownUsersById = {},
    kind,
    localAvatarDetailsById,
    localAvatarFavoriteGroups,
    localAvatarFavorites,
    localFriendFavoriteGroups,
    localFriendFavorites,
    localWorldDetailsById,
    localWorldFavoriteGroups,
    localWorldFavorites,
    remoteEntityDetails,
    remoteFavoritesById,
    remoteWorldCacheFallbacksById,
    remoteAvatarCacheFallbacksById,
    searchMode,
    searchQuery,
    selectedGroupKey,
    selectedSource,
    sortValue,
    worldAvailabilityById,
    worldFactsById
}: FavoritesViewDataInputs) {
    const { t } = useTranslation();

    const favoritesSortIndex = useMemo(() => {
        const index: Record<string, number> = {};
        favoritesSortOrder.forEach((favoriteId, position) => {
            index[favoriteId] = position;
        });
        return index;
    }, [favoritesSortOrder]);

    const pageConfig = useMemo(
        () => getFavoritesPageConfig(kind, t),
        [kind, t]
    );

    const remoteGroups = useMemo(() => {
        return buildFavoriteRemoteGroups({
            kind,
            favoriteFriendGroups,
            favoriteAvatarGroups,
            favoriteWorldGroups
        });
    }, [favoriteAvatarGroups, favoriteFriendGroups, favoriteWorldGroups, kind]);

    const localGroups = useMemo(() => {
        return buildFavoriteLocalGroups({
            kind,
            localFriendFavoriteGroups,
            localAvatarFavoriteGroups,
            localWorldFavoriteGroups,
            localFriendFavorites,
            localAvatarFavorites,
            localWorldFavorites
        });
    }, [
        kind,
        localAvatarFavoriteGroups,
        localAvatarFavorites,
        localFriendFavoriteGroups,
        localFriendFavorites,
        localWorldFavoriteGroups,
        localWorldFavorites
    ]);

    const avatarHistoryGroups = useMemo(() => {
        return buildFavoriteAvatarHistoryGroups({
            kind,
            avatarHistoryLength: avatarHistory.length,
            t
        });
    }, [avatarHistory.length, kind, t]);

    const remoteGroupLabelByKey = useMemo(
        () => buildFavoriteGroupLabelByKey(remoteGroups),
        [remoteGroups]
    );
    const remoteEntityDetailsData = useMemo(
        () => normalizeFavoriteDetailMap(remoteEntityDetails.data),
        [remoteEntityDetails.data]
    );
    const normalizedLocalWorldDetailsById = useMemo(
        () => normalizeFavoriteDetailMap(localWorldDetailsById),
        [localWorldDetailsById]
    );
    const normalizedLocalAvatarDetailsById = useMemo(
        () => normalizeFavoriteDetailMap(localAvatarDetailsById),
        [localAvatarDetailsById]
    );
    const normalizedRemoteWorldCacheFallbacksById = useMemo(
        () => normalizeFavoriteDetailMap(remoteWorldCacheFallbacksById),
        [remoteWorldCacheFallbacksById]
    );
    const normalizedRemoteAvatarCacheFallbacksById = useMemo(
        () => normalizeFavoriteDetailMap(remoteAvatarCacheFallbacksById),
        [remoteAvatarCacheFallbacksById]
    );
    const normalizedAvatarHistory = useMemo(
        () => avatarHistory.filter(isFavoriteEntityDetail),
        [avatarHistory]
    );

    const remoteItemsByGroup = useMemo(() => {
        return buildFavoriteRemoteItemsByGroup({
            kind,
            remoteGroups,
            groupedFavoriteFriendIdsByGroupKey,
            friendsById,
            knownUsersById,
            favoritesSortIndex,
            sortValue,
            remoteFavoritesById,
            remoteEntityDetailsData,
            remoteEntityDetailsStatus: remoteEntityDetails.status,
            worldFactsById,
            remoteWorldCacheFallbacksById:
                normalizedRemoteWorldCacheFallbacksById,
            remoteAvatarCacheFallbacksById:
                normalizedRemoteAvatarCacheFallbacksById,
            localWorldDetailsById: normalizedLocalWorldDetailsById,
            localAvatarDetailsById: normalizedLocalAvatarDetailsById,
            remoteGroupLabelByKey,
            worldAvailabilityById,
            t
        });
    }, [
        favoritesSortIndex,
        friendsById,
        groupedFavoriteFriendIdsByGroupKey,
        knownUsersById,
        kind,
        normalizedLocalAvatarDetailsById,
        normalizedLocalWorldDetailsById,
        remoteEntityDetailsData,
        remoteEntityDetails.status,
        remoteFavoritesById,
        normalizedRemoteAvatarCacheFallbacksById,
        normalizedRemoteWorldCacheFallbacksById,
        remoteGroupLabelByKey,
        remoteGroups,
        sortValue,
        t,
        worldAvailabilityById,
        worldFactsById
    ]);

    const localItemsByGroup = useMemo(() => {
        return buildFavoriteLocalItemsByGroup({
            kind,
            localGroups,
            localFriendFavorites,
            localAvatarFavorites,
            localWorldFavorites,
            localAvatarDetailsById: normalizedLocalAvatarDetailsById,
            localWorldDetailsById: normalizedLocalWorldDetailsById,
            friendsById,
            knownUsersById,
            sortValue,
            t
        });
    }, [
        friendsById,
        knownUsersById,
        kind,
        normalizedLocalAvatarDetailsById,
        localAvatarFavorites,
        localFriendFavorites,
        localGroups,
        normalizedLocalWorldDetailsById,
        localWorldFavorites,
        sortValue,
        t
    ]);

    const avatarHistoryItems = useMemo(() => {
        return buildFavoriteAvatarHistoryItems({
            kind,
            avatarHistory: normalizedAvatarHistory,
            t
        });
    }, [kind, normalizedAvatarHistory, t]);

    const allItems = useMemo(
        () => [
            ...Object.values(remoteItemsByGroup).flat(),
            ...Object.values(localItemsByGroup).flat()
        ],
        [localItemsByGroup, remoteItemsByGroup]
    );

    const searchNeedle = normalizeSearchValue(searchQuery);
    const isSearchActive = searchNeedle.length >= 3;
    const hasSearchInput = searchNeedle.length > 0;
    const filteredItems = useMemo(() => {
        if (!isSearchActive) {
            return [];
        }

        return allItems.filter((item) => {
            if (kind === 'world' && searchMode === 'tag') {
                const matchesTag =
                    Array.isArray(item.tags) &&
                    item.tags.some(
                        (tag) =>
                            typeof tag === 'string' &&
                            tag.startsWith('author_tag_') &&
                            tag
                                .substring(11)
                                .toLowerCase()
                                .includes(searchNeedle)
                    );
                if (!matchesTag) {
                    return false;
                }
            } else {
                const matchesText = [
                    item.title,
                    item.subtitle,
                    item.description,
                    item.id,
                    item.groupLabel,
                    item.statusLabel
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                    .includes(searchNeedle);
                if (!matchesText) {
                    return false;
                }
            }

            return true;
        });
    }, [allItems, isSearchActive, kind, searchMode, searchNeedle]);

    const selectedGroup = useMemo(
        () =>
            (selectedSource === 'remote'
                ? remoteGroups
                : selectedSource === 'history'
                  ? avatarHistoryGroups
                  : localGroups
            ).find((group) => group.key === selectedGroupKey) || null,
        [
            avatarHistoryGroups,
            localGroups,
            remoteGroups,
            selectedGroupKey,
            selectedSource
        ]
    );
    const selectedItems = useMemo(() => {
        if (!selectedGroup) {
            return EMPTY_ITEMS;
        }
        if (selectedSource === 'history') {
            return avatarHistoryItems;
        }
        return (
            (selectedSource === 'remote'
                ? remoteItemsByGroup[selectedGroup.key]
                : localItemsByGroup[selectedGroup.key]) || EMPTY_ITEMS
        );
    }, [
        avatarHistoryItems,
        localItemsByGroup,
        remoteItemsByGroup,
        selectedGroup,
        selectedSource
    ]);
    const contentItems = useMemo(
        () => (isSearchActive ? filteredItems : selectedItems),
        [filteredItems, isSearchActive, selectedItems]
    );

    return {
        allItems,
        avatarHistoryGroups,
        avatarHistoryItems,
        canCreateLocalGroup: true,
        contentItems,
        filteredItems,
        hasSearchInput,
        isSearchActive,
        localGroups,
        localItemsByGroup,
        pageConfig,
        remoteGroups,
        remoteItemsByGroup,
        selectedGroup,
        selectedItems
    };
}
