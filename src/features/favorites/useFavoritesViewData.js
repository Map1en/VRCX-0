import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    normalizeFavoriteSearchValue as normalizeSearchValue
} from './favoritesItems.js';
import {
    buildFavoriteAvatarHistoryGroups,
    buildFavoriteAvatarHistoryItems,
    buildFavoriteGroupLabelByKey,
    buildFavoriteLocalGroups,
    buildFavoriteLocalItemsByGroup,
    buildFavoriteRemoteGroups,
    buildFavoriteRemoteItemsByGroup,
    getFavoritesPageConfig
} from './favoritesPageData.js';

const EMPTY_ITEMS = Object.freeze([]);

export function useFavoritesViewData({
    avatarHistory,
    currentUserSnapshot,
    favoriteAvatarGroups,
    favoriteFriendGroups,
    favoriteWorldGroups,
    favoritesSortOrder,
    friendsById,
    groupedFavoriteFriendIdsByGroupKey,
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
    selectedKeysSet,
    selectedSource,
    sortValue
}) {
    const { t } = useTranslation();

    const favoritesSortIndex = useMemo(() => {
        const index = Object.create(null);
        favoritesSortOrder.forEach((favoriteId, position) => {
            index[favoriteId] = position;
        });
        return index;
    }, [favoritesSortOrder]);

    const pageConfig = useMemo(() => getFavoritesPageConfig(kind, t), [kind, t]);

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
            favoritesSortIndex,
            sortValue,
            remoteFavoritesById,
            remoteEntityDetailsData: remoteEntityDetails.data,
            remoteEntityDetailsStatus: remoteEntityDetails.status,
            remoteGroupLabelByKey,
            t
        });
    }, [
        favoritesSortIndex,
        friendsById,
        groupedFavoriteFriendIdsByGroupKey,
        kind,
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
            sortValue,
            t
        });
    }, [
        friendsById,
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
    const isAllSelected =
        contentItems.length > 0 &&
        contentItems.every((item) => selectedKeysSet.has(item.key));
    const avatarEditSelectionDisabled =
        kind === 'avatar' && selectedSource !== 'remote';
    const selectedContentItems = contentItems.filter((item) =>
        selectedKeysSet.has(item.key)
    );
    const canCreateLocalGroup =
        kind !== 'avatar' ||
        Boolean(
            currentUserSnapshot?.$isVRCPlus ||
                currentUserSnapshot?.tags?.includes?.('system_supporter')
        );

    return {
        allItems,
        avatarEditSelectionDisabled,
        avatarHistoryGroups,
        avatarHistoryItems,
        canCreateLocalGroup,
        contentItems,
        filteredItems,
        hasSearchInput,
        isAllSelected,
        isSearchActive,
        localGroups,
        localItemsByGroup,
        pageConfig,
        remoteGroups,
        remoteItemsByGroup,
        selectedContentItems,
        selectedGroup,
        selectedItems
    };
}
