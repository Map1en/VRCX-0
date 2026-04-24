import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import {
    avatarProfileRepository,
    avatarLocalRepository,
    configRepository,
    localFavoritesRepository,
    notificationRepository,
    vrchatSearchRepository,
    vrchatFavoriteRepository
} from '@/repositories/index.js';
import {
    openWorldDialog
} from '@/services/dialogService.js';
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
import {
    clearFavoriteRemoteDetailsCache,
    useFavoriteRemoteDetails
} from './useFavoriteRemoteDetails.js';
import { FavoritesPageView } from './components/FavoritesPageView.jsx';
import { useFavoritesLayoutPreferences } from './useFavoritesLayoutPreferences.js';
import { useFavoritesViewData } from './useFavoritesViewData.js';

function FavoritesPage({ kind, embedded = false }) {
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
    const gameState = useRuntimeStore((state) => state.gameState);
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

    const refreshFavorites = async () => {
        if (!currentUserId || !currentUserSnapshot || refreshing) {
            return;
        }

        setRefreshing(true);
        try {
            clearFavoriteRemoteDetailsCache();
            setRemoteDetailsRefreshToken((value) => value + 1);
            await bootstrapFavorites({
                userId: currentUserId,
                endpoint: currentEndpoint,
                currentUserSnapshot
            });
            if (kind === 'avatar') {
                const rows = await avatarLocalRepository.getAvatarHistory(
                    currentUserId,
                    100
                );
                setAvatarHistory(Array.isArray(rows) ? rows : []);
            }
            toast.success(t('view.favorite.generated.favorites_refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_refresh_favorites')
            );
        } finally {
            setRefreshing(false);
        }
    };

    const handleSortValueChange = (value) => {
        setSortValue(value);
        if (value === 'date' || value === 'name') {
            const nextSortByDate = value === 'date';
            void setBoolConfigPreference('sortFavorites', nextSortByDate).catch(
                (error) => {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t('view.favorites.generated_toast.failed_to_save_favorite_sort_preference')
                    );
                }
            );
        }
    };

    const handleRemoveLocalFavorite = async (item, { silent = false } = {}) => {
        if (
            !item ||
            item.source !== 'local' ||
            (!silent && removingFavoriteKeyRef.current)
        ) {
            return false;
        }

        if (!silent) {
            removingFavoriteKeyRef.current = item.key;
            setRemovingFavoriteKey(item.key);
            const result = await confirm({
                title: t('view.favorites.generated_modal.remove_local_favorite'),
                description: t(
                    'view.favorites.generated_dynamic.remove_value_from_value',
                    {
                        value:
                            item.title ||
                            t('view.favorites.generated.favorite_fallback'),
                        value2:
                            item.groupLabel ||
                            t(
                                'view.favorites.generated.favorites_fallback'
                            )
                    }
                ),
                destructive: true,
                confirmText: t('common.actions.remove'),
                cancelText: t('common.actions.cancel')
            });

            if (!result.ok) {
                removingFavoriteKeyRef.current = '';
                setRemovingFavoriteKey('');
                return false;
            }
        }

        try {
            await localFavoritesRepository.removeLocalFavorite({
                kind: item.kind,
                entityId: item.id,
                groupName: item.groupKey
            });
            removeLocalFavorite({
                kind: item.kind,
                entityId: item.id,
                groupName: item.groupKey
            });
            if (!silent) {
                toast.success(t('view.favorite.generated.local_favorite_removed'));
            }
            return true;
        } catch (error) {
            if (silent) {
                throw error;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_remove_local_favorite')
            );
            return false;
        } finally {
            if (!silent) {
                removingFavoriteKeyRef.current = '';
                setRemovingFavoriteKey((currentKey) =>
                    currentKey === item.key ? '' : currentKey
                );
            }
        }
    };

    const handleRemoveRemoteFavorite = async (
        item,
        { silent = false } = {}
    ) => {
        if (
            !item ||
            item.source !== 'remote' ||
            (!silent && removingFavoriteKeyRef.current)
        ) {
            return false;
        }

        if (!silent) {
            removingFavoriteKeyRef.current = item.key;
            setRemovingFavoriteKey(item.key);
            const result = await confirm({
                title: t('view.favorites.generated_modal.remove_vrchat_favorite'),
                description: t(
                    'view.favorites.generated_dynamic.remove_value_from_value',
                    {
                        value:
                            item.title ||
                            t('view.favorites.generated.favorite_fallback'),
                        value2:
                            item.groupLabel ||
                            t(
                                'view.favorites.generated.favorites_fallback'
                            )
                    }
                ),
                destructive: true,
                confirmText: t('common.actions.remove'),
                cancelText: t('common.actions.cancel')
            });

            if (!result.ok) {
                removingFavoriteKeyRef.current = '';
                setRemovingFavoriteKey('');
                return false;
            }
        }

        try {
            await vrchatFavoriteRepository.deleteFavorite({
                endpoint: currentEndpoint,
                objectId: item.id
            });
            removeRemoteFavorite(item.id);
            if (!silent) {
                toast.success(t('view.favorite.generated.vrchat_favorite_removed'));
            }
            return true;
        } catch (error) {
            if (silent) {
                throw error;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_remove_vrchat_favorite')
            );
            return false;
        } finally {
            if (!silent) {
                removingFavoriteKeyRef.current = '';
                setRemovingFavoriteKey((currentKey) =>
                    currentKey === item.key ? '' : currentKey
                );
            }
        }
    };

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

    async function exportCurrentFavorites() {
        if (!allItems.length) {
            toast.error(t('view.favorite.generated.no_favorites_available_to_export'));
            return;
        }

        setExportDialogOpen(true);
    }

    async function handleRemoteGroupRename(group) {
        const result = await prompt({
            title: t('view.favorites.generated_modal.change_favorite_group_name'),
            description: t('view.favorites.generated_modal.enter_the_new_display_name'),
            inputValue: group.label || group.name,
            pattern: /\S+/,
            confirmText: t('view.favorites.generated_modal.change'),
            cancelText: t('common.actions.cancel'),
            errorMessage: t(
                'view.favorites.generated_modal.group_name_required'
            )
        });
        if (!result.ok) {
            return;
        }
        const nextName = result.value.trim();
        if (!nextName || nextName === group.label) {
            return;
        }

        try {
            await vrchatFavoriteRepository.saveFavoriteGroup({
                endpoint: currentEndpoint,
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name,
                displayName: nextName
            });
            await refreshFavorites();
            toast.success(t('view.favorite.generated.favorite_group_renamed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_rename_favorite_group')
            );
        }
    }

    async function handleRemoteGroupVisibility(group, visibility) {
        if (group.visibility === visibility) {
            return;
        }

        try {
            await vrchatFavoriteRepository.saveFavoriteGroup({
                endpoint: currentEndpoint,
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name,
                visibility
            });
            await refreshFavorites();
            toast.success(t('view.favorite.generated.group_visibility_changed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_change_group_visibility')
            );
        }
    }

    async function handleRemoteGroupClear(group) {
        const result = await confirm({
            title: t('view.favorites.generated_modal.clear_favorite_group'),
            description: t('view.favorites.generated_modal.remove_all_favorites_from_this_group'),
            destructive: true,
            confirmText: t('common.actions.clear'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        try {
            await vrchatFavoriteRepository.clearFavoriteGroup({
                endpoint: currentEndpoint,
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name
            });
            await refreshFavorites();
            toast.success(t('view.favorite.generated.favorite_group_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_clear_favorite_group')
            );
        }
    }

    async function handleLocalGroupRename(group) {
        const result = await prompt({
            title: t('view.favorites.generated_modal.rename_local_favorite_group'),
            description: t('view.favorites.generated_modal.enter_the_new_local_group_name'),
            inputValue: group.label,
            pattern: /\S+/,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel'),
            errorMessage: t(
                'view.favorites.generated_modal.group_name_required'
            )
        });
        if (!result.ok) {
            return;
        }
        const nextName = result.value.trim();
        if (!nextName || nextName === group.key) {
            return;
        }
        if (localGroups.some((localGroup) => localGroup.key === nextName)) {
            toast.error(t('view.favorites.generated_dynamic.local_group_value_already_exists', { value: nextName }));
            return;
        }

        try {
            await localFavoritesRepository.renameLocalFavoriteGroup({
                kind,
                groupName: group.key,
                newGroupName: nextName
            });
            renameLocalFavoriteGroup({
                kind,
                groupName: group.key,
                newGroupName: nextName
            });
            if (selectedSource === 'local' && selectedGroupKey === group.key) {
                setSelectedGroupKey(nextName);
            }
            toast.success(t('view.favorite.generated.local_favorite_group_renamed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_rename_local_favorite_group')
            );
        }
    }

    async function handleLocalGroupDelete(group) {
        const result = await confirm({
            title: t('view.favorites.generated_modal.delete_local_favorite_group'),
            description: t('view.favorites.generated_modal.delete_value', { value: group.label }),
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        try {
            await localFavoritesRepository.deleteLocalFavoriteGroup({
                kind,
                groupName: group.key
            });
            deleteLocalFavoriteGroup({ kind, groupName: group.key });
            if (selectedSource === 'local' && selectedGroupKey === group.key) {
                setSelectedGroupKey('');
            }
            toast.success(t('view.favorite.generated.local_favorite_group_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_delete_local_favorite_group')
            );
        }
    }

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
                    : t('view.favorites.generated_toast.failed_to_refresh_avatar_history')
            );
        } finally {
            setAvatarHistoryLoading(false);
        }
    }

    async function handleAvatarHistoryClear() {
        const result = await confirm({
            title: t('view.favorites.generated_modal.clear_avatar_history'),
            description:
                t('view.favorites.generated_modal.clear_local_avatar_history_and_cached_avatar_met'),
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
                    : t('view.favorites.generated_toast.failed_to_clear_avatar_history')
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
                toast.success(t('view.favorite.generated.vrchat_launch_request_sent'));
                return;
            }
            toast.error(t('view.favorite.generated.unable_to_open_this_instance_in_vrchat'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_launch_instance')
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
            toast.error(t('view.favorite.generated.cannot_self_invite_to_this_instance'));
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
                    : t('view.favorites.generated_toast.failed_to_send_self_invite')
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
                t('view.favorite.generated.cannot_invite_no_current_vrchat_location_is_available')
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(t('view.favorite.generated.cannot_invite_from_the_current_instance_type'));
            return;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t('view.favorite.generated.cannot_invite_current_location_is_not_a_concrete_instance')
            );
            return;
        }

        const result = await confirm({
            title: t('view.favorites.generated_modal.send_invite'),
            description:
                friend?.displayName ||
                t('view.favorites.generated.this_user'),
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
                friend?.displayName ||
                t('view.favorites.generated.this_user'),
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
                    : t('view.favorites.generated_toast.failed_to_request_invite')
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
                description:
                    t('view.favorites.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'),
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
                error instanceof Error ? error.message : t('view.favorites.generated_toast.failed_to_send_boop')
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
                    item.title ||
                    t('view.favorites.generated.avatar_fallback'),
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
                    : t('view.favorites.generated_toast.failed_to_select_avatar')
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
            toast.error(t('view.favorites.generated_dynamic.local_group_value_already_exists', { value: nextName }));
            return;
        }
        try {
            await localFavoritesRepository.createLocalFavoriteGroup({
                kind,
                groupName: nextName
            });
            createLocalFavoriteGroup({ kind, groupName: nextName });
            setSelectedSource('local');
            setSelectedGroupKey(nextName);
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_create_local_favorite_group')
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
            toast.success(t('view.favorite.generated.copied_selected_favorite_ids'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_copy_selected_favorites')
            );
        }
    }

    async function bulkRemoveSelection() {
        if (!selectedContentItems.length) {
            return;
        }

        const result = await confirm({
            title: t('view.favorites.generated_modal.delete_value_favorites', { value: selectedContentItems.length }),
            description: t('view.favorites.generated_modal.this_action_cannot_be_undone'),
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        let removedCount = 0;
        let failedCount = 0;
        const removedKeys = new Set();
        for (const item of selectedContentItems) {
            try {
                const removed =
                    item.source === 'local'
                        ? await handleRemoveLocalFavorite(item, {
                              silent: true
                          })
                        : await handleRemoveRemoteFavorite(item, {
                              silent: true
                          });
                if (removed) {
                    removedCount += 1;
                    removedKeys.add(item.key);
                } else {
                    failedCount += 1;
                }
            } catch {
                failedCount += 1;
            }
        }
        if (removedCount > 0) {
            setSelectedKeys((current) =>
                current.filter((key) => !removedKeys.has(key))
            );
        }
        if (failedCount === 0) {
            setEditMode(false);
            toast.success(t('view.favorite.generated.selected_favorites_removed'));
            return;
        }
        toast.error(t('view.favorites.generated_dynamic.removed_value_value_failed', { value: removedCount, value2: failedCount }));
    }

    return (
        <FavoritesPageView
            avatarEditSelectionDisabled={avatarEditSelectionDisabled}
            avatarHistoryGroups={avatarHistoryGroups}
            avatarHistoryLoading={avatarHistoryLoading}
            bulkRemoveSelection={bulkRemoveSelection}
            canBoop={canBoop}
            canCreateLocalGroup={canCreateLocalGroup}
            canSendInvite={canSendInvite}
            cardScale={cardScale}
            cardSpacing={cardSpacing}
            confirmCreateLocalGroup={confirmCreateLocalGroup}
            contentItems={contentItems}
            copySelection={copySelection}
            creatingLocalGroup={creatingLocalGroup}
            currentAvatarId={currentUserSnapshot?.currentAvatar || ''}
            currentUserId={currentUserId}
            editMode={editMode}
            embedded={embedded}
            exportCurrentFavorites={exportCurrentFavorites}
            exportDialogOpen={exportDialogOpen}
            favoriteDetail={favoriteDetail}
            favoriteLoadStatus={favoriteLoadStatus}
            handleCardScaleChange={handleCardScaleChange}
            handleCardSpacingChange={handleCardSpacingChange}
            handleLocalGroupDelete={handleLocalGroupDelete}
            handleLocalGroupRename={handleLocalGroupRename}
            handleRemoveLocalFavorite={handleRemoveLocalFavorite}
            handleRemoveRemoteFavorite={handleRemoveRemoteFavorite}
            handleRemoteGroupClear={handleRemoteGroupClear}
            handleRemoteGroupRename={handleRemoteGroupRename}
            handleRemoteGroupVisibility={handleRemoteGroupVisibility}
            handleSortValueChange={handleSortValueChange}
            hasSearchInput={hasSearchInput}
            isAllSelected={isAllSelected}
            isSearchActive={isSearchActive}
            kind={kind}
            launchFavoriteFriendLocation={launchFavoriteFriendLocation}
            localGroups={localGroups}
            localItemsByGroup={localItemsByGroup}
            newLocalGroupName={newLocalGroupName}
            onHandleAvatarHistoryClear={handleAvatarHistoryClear}
            onImportFavorites={() => openFavoriteImportDialog({ type: kind })}
            onSplitterResize={handleSplitterResize}
            openWorldNewInstance={openWorldNewInstance}
            pageConfig={pageConfig}
            persistSplitterLayout={persistSplitterLayout}
            refreshAvatarHistory={refreshAvatarHistory}
            refreshFavorites={refreshFavorites}
            refreshing={refreshing}
            remoteEntityDetails={remoteEntityDetails}
            remoteGroups={remoteGroups}
            remoteItemsByGroup={remoteItemsByGroup}
            removingFavoriteKey={removingFavoriteKey}
            requestFavoriteFriendInvite={requestFavoriteFriendInvite}
            searchMode={searchMode}
            searchQuery={searchQuery}
            selectedGroup={selectedGroup}
            selectedGroupKey={selectedGroupKey}
            selectedKeysSet={selectedKeysSet}
            selectedSource={selectedSource}
            selectFavoriteAvatar={selectFavoriteAvatar}
            selfInviteFavoriteFriendLocation={selfInviteFavoriteFriendLocation}
            sendFavoriteFriendBoop={sendFavoriteFriendBoop}
            sendFavoriteFriendInvite={sendFavoriteFriendInvite}
            setCreatingLocalGroup={setCreatingLocalGroup}
            setEditMode={setEditMode}
            setExportDialogOpen={setExportDialogOpen}
            setNewLocalGroupName={setNewLocalGroupName}
            setSearchMode={setSearchMode}
            setSearchQuery={setSearchQuery}
            setSelectedGroupKey={setSelectedGroupKey}
            setSelectedKeys={setSelectedKeys}
            setSelectedSource={setSelectedSource}
            sortValue={sortValue}
            splitterLayoutVersion={splitterLayoutVersion}
            splitterSizePx={splitterSizePx}
            toggleSelectAll={toggleSelectAll}
        />
    );
}

export function FavoriteFriendsPage(props) {
    return <FavoritesPage kind="friend" {...props} />;
}

export function FavoriteWorldsPage(props) {
    return <FavoritesPage kind="world" {...props} />;
}

export function FavoriteAvatarsPage(props) {
    return <FavoritesPage kind="avatar" {...props} />;
}
