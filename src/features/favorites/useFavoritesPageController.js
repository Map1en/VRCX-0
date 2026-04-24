import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    avatarProfileRepository,
    avatarLocalRepository,
    configRepository,
    localFavoritesRepository,
    notificationRepository,
    vrchatSearchRepository,
    vrchatFavoriteRepository
} from '@/repositories/index.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { bootstrapFavorites } from '@/services/favoriteBootstrapService.js';
import { openFavoriteImportDialog } from '@/services/favoriteImportService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { setBoolConfigPreference } from '@/services/preferencesService.js';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import {
    favoriteGroupType,
    normalizeFavoriteEntityId as normalizeEntityId,
    resolveCurrentInviteLocation
} from './favoritesItems.js';
import { resolveFavoritePresenceLocation } from './favoritesPageData.js';
import { useFavoriteRemoteDetails } from './useFavoriteRemoteDetails.js';
import { useFavoritesLayoutPreferences } from './useFavoritesLayoutPreferences.js';
import { useFavoritesPageActions } from './useFavoritesPageActions.js';
import { useFavoritesViewData } from './useFavoritesViewData.js';
export function useFavoritesPageController({ kind, embedded = false }) {
    const { t } = useTranslation();
    const favoriteLoadStatus = useFavoriteStore((state) => state.loadStatus);
    const favoriteDetail = useFavoriteStore((state) => state.detail);
    const favoritesSortOrder = useFavoriteStore(
        (state) => state.favoritesSortOrder
    );
    const remoteFavoritesById = useFavoriteStore(
        (state) => state.remoteFavoritesById
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const favoriteWorldGroups = useFavoriteStore(
        (state) => state.favoriteWorldGroups
    );
    const favoriteAvatarGroups = useFavoriteStore(
        (state) => state.favoriteAvatarGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localWorldFavorites = useFavoriteStore(
        (state) => state.localWorldFavorites
    );
    const localAvatarFavorites = useFavoriteStore(
        (state) => state.localAvatarFavorites
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const localWorldFavoriteGroups = useFavoriteStore(
        (state) => state.localWorldFavoriteGroups
    );
    const localAvatarFavoriteGroups = useFavoriteStore(
        (state) => state.localAvatarFavoriteGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const localWorldDetailsById = useFavoriteStore(
        (state) => state.localWorldDetailsById
    );
    const localAvatarDetailsById = useFavoriteStore(
        (state) => state.localAvatarDetailsById
    );
    const favoriteWorldIds = useFavoriteStore(
        (state) => state.favoriteWorldIds
    );
    const favoriteAvatarIds = useFavoriteStore(
        (state) => state.favoriteAvatarIds
    );
    const removeLocalFavorite = useFavoriteStore(
        (state) => state.removeLocalFavorite
    );
    const removeRemoteFavorite = useFavoriteStore(
        (state) => state.removeRemoteFavorite
    );
    const createLocalFavoriteGroup = useFavoriteStore(
        (state) => state.createLocalFavoriteGroup
    );
    const renameLocalFavoriteGroup = useFavoriteStore(
        (state) => state.renameLocalFavoriteGroup
    );
    const deleteLocalFavoriteGroup = useFavoriteStore(
        (state) => state.deleteLocalFavoriteGroup
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            isGameRunning
        }),
        [isGameRunning, runtimeCurrentDestination, runtimeCurrentLocation]
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const sortFavorites = usePreferencesStore((state) => state.sortFavorites);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState('name');
    const [sortValue, setSortValue] = useState('date');
    const [selectedSource, setSelectedSource] = useState('remote');
    const [selectedGroupKey, setSelectedGroupKey] = useState('');
    const [removingFavoriteKey, setRemovingFavoriteKey] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [avatarHistoryLoading, setAvatarHistoryLoading] = useState(false);
    const [avatarHistory, setAvatarHistory] = useState([]);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [selectedKeys, setSelectedKeys] = useState([]);
    const [creatingLocalGroup, setCreatingLocalGroup] = useState(false);
    const [newLocalGroupName, setNewLocalGroupName] = useState('');
    const [remoteDetailsRefreshToken, setRemoteDetailsRefreshToken] =
        useState(0);
    const removingFavoriteKeyRef = useRef('');
    const {
        cardScale,
        cardSpacing,
        handleCardScaleChange,
        handleCardSpacingChange,
        handleSplitterResize,
        persistSplitterLayout,
        splitterLayoutVersion,
        splitterSizePx
    } = useFavoritesLayoutPreferences(kind);
    const selectedKeysSet = useMemo(
        () => new Set(selectedKeys),
        [selectedKeys]
    );
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
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
    const canSendInvite = Boolean(
        gameState?.isGameRunning &&
        currentInviteLocation &&
        canInviteFromCurrentLocation
    );
    const canBoop = Boolean(currentUserSnapshot?.isBoopingEnabled);
    const avatarTags = useMemo(
        () =>
            kind === 'avatar'
                ? Array.from(
                      new Set(
                          Object.values(remoteFavoritesById)
                              .filter((favorite) => favorite?.type === 'avatar')
                              .map((favorite) =>
                                  typeof favorite?.tags?.[0] === 'string'
                                      ? favorite.tags[0].trim()
                                      : ''
                              )
                              .filter(Boolean)
                      )
                  )
                : [],
        [kind, remoteFavoritesById]
    );
    const remoteEntityDetails = useFavoriteRemoteDetails({
        type: kind === 'avatar' ? 'avatar' : 'world',
        favoriteIds:
            kind === 'world'
                ? favoriteWorldIds
                : kind === 'avatar'
                  ? favoriteAvatarIds
                  : [],
        avatarTags,
        refreshToken: remoteDetailsRefreshToken,
        enabled:
            kind !== 'friend' &&
            favoriteLoadStatus === 'ready' &&
            (kind === 'world'
                ? favoriteWorldIds.length > 0
                : favoriteAvatarIds.length > 0)
    });
    useEffect(() => {
        setSortValue(sortFavorites ? 'date' : 'name');
    }, [sortFavorites]);
    useEffect(() => {
        setEditMode(false);
        setSelectedKeys([]);
        setSearchQuery('');
        setSearchMode('name');
        setSelectedSource('remote');
        setSelectedGroupKey('');
        setExportDialogOpen(false);
        setCreatingLocalGroup(false);
        setNewLocalGroupName('');
        if (kind !== 'avatar') {
            setAvatarHistory([]);
        }
    }, [kind]);
    useEffect(() => {
        let active = true;
        if (kind !== 'avatar' || !currentUserId) {
            setAvatarHistory([]);
            return () => {
                active = false;
            };
        }
        setAvatarHistoryLoading(true);
        avatarLocalRepository
            .getAvatarHistory(currentUserId, 100)
            .then((rows) => {
                if (active) {
                    setAvatarHistory(Array.isArray(rows) ? rows : []);
                }
            })
            .catch(() => {
                if (active) {
                    setAvatarHistory([]);
                }
            })
            .finally(() => {
                if (active) {
                    setAvatarHistoryLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [currentUserId, kind]);
    useEffect(() => {
        if (kind !== 'world' && sortValue === 'players') {
            setSortValue('date');
        }
    }, [kind, sortValue]);
    const {
        allItems,
        avatarEditSelectionDisabled,
        avatarHistoryGroups,
        canCreateLocalGroup,
        contentItems,
        hasSearchInput,
        isAllSelected,
        isSearchActive,
        localGroups,
        localItemsByGroup,
        pageConfig,
        remoteGroups,
        remoteItemsByGroup,
        selectedContentItems,
        selectedGroup
    } = useFavoritesViewData({
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
    });
    const {
        refreshFavorites,
        handleSortValueChange,
        handleRemoveLocalFavorite,
        handleRemoveRemoteFavorite,
        exportCurrentFavorites,
        handleRemoteGroupRename,
        handleRemoteGroupVisibility,
        handleRemoteGroupClear,
        handleLocalGroupRename,
        handleLocalGroupDelete,
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
        copySelection,
        bulkRemoveSelection
    } = useFavoritesPageActions({
        allItems,
        avatarHistoryLoading,
        avatarLocalRepository,
        avatarProfileRepository,
        bootstrapFavorites,
        canInviteFromCurrentLocation,
        checkCanInviteSelf,
        configRepository,
        confirm,
        contentItems,
        createLocalFavoriteGroup,
        currentEndpoint,
        currentInviteLocation,
        currentUserId,
        currentUserSnapshot,
        deleteLocalFavoriteGroup,
        favoriteGroupType,
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
        removeLocalFavorite,
        removeRemoteFavorite,
        removingFavoriteKeyRef,
        renameLocalFavoriteGroup,
        resolveFavoritePresenceLocation,
        selectedContentItems,
        selectedGroupKey,
        selectedSource,
        selfInviteToInstance,
        setAvatarHistory,
        setAvatarHistoryLoading,
        setBoolConfigPreference,
        setCreatingLocalGroup,
        setEditMode,
        setExportDialogOpen,
        setNewLocalGroupName,
        setRefreshing,
        setRemoteDetailsRefreshToken,
        setRemovingFavoriteKey,
        setSelectedGroupKey,
        setSelectedKeys,
        setSelectedSource,
        setSortValue,
        t,
        toast,
        tryOpenLaunchLocation,
        vrchatFavoriteRepository,
        vrchatSearchRepository
    });
    useEffect(() => {
        const hasSelection = (
            selectedSource === 'remote'
                ? remoteGroups
                : selectedSource === 'history'
                  ? avatarHistoryGroups
                  : localGroups
        ).some((group) => group.key === selectedGroupKey);
        if (hasSelection) {
            return;
        }
        const nextGroup =
            remoteGroups.find((group) => group.count > 0) ||
            localGroups.find((group) => group.count > 0) ||
            avatarHistoryGroups.find((group) => group.count > 0) ||
            remoteGroups[0] ||
            localGroups[0] ||
            avatarHistoryGroups[0] ||
            null;
        if (!nextGroup) {
            setSelectedGroupKey('');
            return;
        }
        setSelectedSource(nextGroup.source);
        setSelectedGroupKey(nextGroup.key);
    }, [
        avatarHistoryGroups,
        localGroups,
        remoteGroups,
        selectedGroupKey,
        selectedSource
    ]);
    useEffect(() => {
        if (isSearchActive && editMode) {
            setEditMode(false);
            setSelectedKeys([]);
        }
    }, [editMode, isSearchActive]);
    useEffect(() => {
        setSelectedKeys((keys) => {
            const nextKeys = keys.filter((key) =>
                contentItems.some((item) => item.key === key)
            );
            return nextKeys.length === keys.length ? keys : nextKeys;
        });
    }, [contentItems]);
    return {
        avatarEditSelectionDisabled: avatarEditSelectionDisabled,
        avatarHistoryGroups: avatarHistoryGroups,
        avatarHistoryLoading: avatarHistoryLoading,
        bulkRemoveSelection: bulkRemoveSelection,
        canBoop: canBoop,
        canCreateLocalGroup: canCreateLocalGroup,
        canSendInvite: canSendInvite,
        cardScale: cardScale,
        cardSpacing: cardSpacing,
        confirmCreateLocalGroup: confirmCreateLocalGroup,
        contentItems: contentItems,
        copySelection: copySelection,
        creatingLocalGroup: creatingLocalGroup,
        currentAvatarId: currentUserSnapshot?.currentAvatar || '',
        currentUserId: currentUserId,
        editMode: editMode,
        embedded: embedded,
        exportCurrentFavorites: exportCurrentFavorites,
        exportDialogOpen: exportDialogOpen,
        favoriteDetail: favoriteDetail,
        favoriteLoadStatus: favoriteLoadStatus,
        handleCardScaleChange: handleCardScaleChange,
        handleCardSpacingChange: handleCardSpacingChange,
        handleLocalGroupDelete: handleLocalGroupDelete,
        handleLocalGroupRename: handleLocalGroupRename,
        handleRemoveLocalFavorite: handleRemoveLocalFavorite,
        handleRemoveRemoteFavorite: handleRemoveRemoteFavorite,
        handleRemoteGroupClear: handleRemoteGroupClear,
        handleRemoteGroupRename: handleRemoteGroupRename,
        handleRemoteGroupVisibility: handleRemoteGroupVisibility,
        handleSortValueChange: handleSortValueChange,
        hasSearchInput: hasSearchInput,
        isAllSelected: isAllSelected,
        isSearchActive: isSearchActive,
        kind: kind,
        launchFavoriteFriendLocation: launchFavoriteFriendLocation,
        localGroups: localGroups,
        localItemsByGroup: localItemsByGroup,
        newLocalGroupName: newLocalGroupName,
        onHandleAvatarHistoryClear: handleAvatarHistoryClear,
        onImportFavorites: () =>
            openFavoriteImportDialog({
                type: kind
            }),
        onSplitterResize: handleSplitterResize,
        openWorldNewInstance: openWorldNewInstance,
        pageConfig: pageConfig,
        persistSplitterLayout: persistSplitterLayout,
        refreshAvatarHistory: refreshAvatarHistory,
        refreshFavorites: refreshFavorites,
        refreshing: refreshing,
        remoteEntityDetails: remoteEntityDetails,
        remoteGroups: remoteGroups,
        remoteItemsByGroup: remoteItemsByGroup,
        removingFavoriteKey: removingFavoriteKey,
        requestFavoriteFriendInvite: requestFavoriteFriendInvite,
        searchMode: searchMode,
        searchQuery: searchQuery,
        selectedGroup: selectedGroup,
        selectedGroupKey: selectedGroupKey,
        selectedKeysSet: selectedKeysSet,
        selectedSource: selectedSource,
        selectFavoriteAvatar: selectFavoriteAvatar,
        selfInviteFavoriteFriendLocation: selfInviteFavoriteFriendLocation,
        sendFavoriteFriendBoop: sendFavoriteFriendBoop,
        sendFavoriteFriendInvite: sendFavoriteFriendInvite,
        setCreatingLocalGroup: setCreatingLocalGroup,
        setEditMode: setEditMode,
        setExportDialogOpen: setExportDialogOpen,
        setNewLocalGroupName: setNewLocalGroupName,
        setSearchMode: setSearchMode,
        setSearchQuery: setSearchQuery,
        setSelectedGroupKey: setSelectedGroupKey,
        setSelectedKeys: setSelectedKeys,
        setSelectedSource: setSelectedSource,
        sortValue: sortValue,
        splitterLayoutVersion: splitterLayoutVersion,
        splitterSizePx: splitterSizePx,
        toggleSelectAll: toggleSelectAll
    };
}
