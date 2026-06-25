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
    getFavoritesPageConfig
} from './favoritesPageData';
import type { FavoriteItem } from './favoritesTypes';

const EMPTY_ITEMS: FavoriteItem[] = [];

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
    searchMode,
    searchQuery,
    selectedGroupKey,
    selectedSource,
    sortValue
}: any) {
    const { t } = useTranslation();

    const favoritesSortIndex = useMemo(() => {
        const index = Object.create(null);
        favoritesSortOrder.forEach((favoriteId: any, position: any) => {
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
            remoteEntityDetailsData: remoteEntityDetails.data,
            remoteEntityDetailsStatus: remoteEntityDetails.status,
            localWorldDetailsById,
            remoteGroupLabelByKey,
            t
        });
    }, [
        favoritesSortIndex,
        friendsById,
        groupedFavoriteFriendIdsByGroupKey,
        knownUsersById,
        kind,
        localWorldDetailsById,
        remoteEntityDetails.data,
        remoteEntityDetails.status,
        remoteFavoritesById,
        remoteGroupLabelByKey,
        remoteGroups,
        sortValue,
        t
    ]);

    const localItemsByGroup = useMemo(() => {
        return buildFavoriteLocalItemsByGroup({
            kind,
            localGroups,
            localFriendFavorites,
            localAvatarFavorites,
            localWorldFavorites,
            localAvatarDetailsById,
            localWorldDetailsById,
            friendsById,
            knownUsersById,
            sortValue,
            t
        });
    }, [
        friendsById,
        knownUsersById,
        kind,
        localAvatarDetailsById,
        localAvatarFavorites,
        localFriendFavorites,
        localGroups,
        localWorldDetailsById,
        localWorldFavorites,
        sortValue,
        t
    ]);

    const avatarHistoryItems = useMemo(() => {
        return buildFavoriteAvatarHistoryItems({ kind, avatarHistory, t });
    }, [avatarHistory, kind, t]);

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
