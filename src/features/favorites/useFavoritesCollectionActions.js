import { clearFavoriteRemoteDetailsCache } from '@/services/favoriteRemoteDetailsCacheService.js';

export function useFavoritesCollectionActions({
    allItems,
    avatarLocalRepository,
    bootstrapFavorites,
    confirm,
    currentEndpoint,
    currentUserId,
    currentUserSnapshot,
    deleteLocalFavoriteGroup,
    favoriteGroupType,
    kind,
    localFavoritesRepository,
    localGroups,
    prompt,
    refreshing,
    removeLocalFavorite,
    removeRemoteFavorite,
    removingFavoriteKeyRef,
    renameLocalFavoriteGroup,
    selectedGroupKey,
    selectedSource,
    setAvatarHistory,
    setBoolConfigPreference,
    setExportDialogOpen,
    setRefreshing,
    setRemoteDetailsRefreshToken,
    setRemovingFavoriteKey,
    setSelectedGroupKey,
    setSortValue,
    t,
    toast,
    vrchatFavoriteRepository
}) {
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
                    : t(
                          'view.favorites.generated_toast.failed_to_refresh_favorites'
                      )
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
                            : t(
                                  'view.favorites.generated_toast.failed_to_save_favorite_sort_preference'
                              )
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
                title: t(
                    'view.favorites.generated_modal.remove_local_favorite'
                ),
                description: t(
                    'view.favorites.generated_dynamic.remove_value_from_value',
                    {
                        value:
                            item.title ||
                            t('view.favorites.generated.favorite_fallback'),
                        value2:
                            item.groupLabel ||
                            t('view.favorites.generated.favorites_fallback')
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
                toast.success(
                    t('view.favorite.generated.local_favorite_removed')
                );
            }
            return true;
        } catch (error) {
            if (silent) {
                throw error;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_remove_local_favorite'
                      )
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
                title: t(
                    'view.favorites.generated_modal.remove_vrchat_favorite'
                ),
                description: t(
                    'view.favorites.generated_dynamic.remove_value_from_value',
                    {
                        value:
                            item.title ||
                            t('view.favorites.generated.favorite_fallback'),
                        value2:
                            item.groupLabel ||
                            t('view.favorites.generated.favorites_fallback')
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
                toast.success(
                    t('view.favorite.generated.vrchat_favorite_removed')
                );
            }
            return true;
        } catch (error) {
            if (silent) {
                throw error;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_remove_vrchat_favorite'
                      )
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
    async function exportCurrentFavorites() {
        if (!allItems.length) {
            toast.error(
                t('view.favorite.generated.no_favorites_available_to_export')
            );
            return;
        }
        setExportDialogOpen(true);
    }
    async function handleRemoteGroupRename(group) {
        const result = await prompt({
            title: t(
                'view.favorites.generated_modal.change_favorite_group_name'
            ),
            description: t(
                'view.favorites.generated_modal.enter_the_new_display_name'
            ),
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
                    : t(
                          'view.favorites.generated_toast.failed_to_rename_favorite_group'
                      )
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
            toast.success(
                t('view.favorite.generated.group_visibility_changed')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_change_group_visibility'
                      )
            );
        }
    }
    async function handleRemoteGroupClear(group) {
        const result = await confirm({
            title: t('view.favorites.generated_modal.clear_favorite_group'),
            description: t(
                'view.favorites.generated_modal.remove_all_favorites_from_this_group'
            ),
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
                    : t(
                          'view.favorites.generated_toast.failed_to_clear_favorite_group'
                      )
            );
        }
    }
    async function handleLocalGroupRename(group) {
        const result = await prompt({
            title: t(
                'view.favorites.generated_modal.rename_local_favorite_group'
            ),
            description: t(
                'view.favorites.generated_modal.enter_the_new_local_group_name'
            ),
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
            toast.error(
                t(
                    'view.favorites.generated_dynamic.local_group_value_already_exists',
                    {
                        value: nextName
                    }
                )
            );
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
            toast.success(
                t('view.favorite.generated.local_favorite_group_renamed')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_rename_local_favorite_group'
                      )
            );
        }
    }
    async function handleLocalGroupDelete(group) {
        const result = await confirm({
            title: t(
                'view.favorites.generated_modal.delete_local_favorite_group'
            ),
            description: t('view.favorites.generated_modal.delete_value', {
                value: group.label
            }),
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
            deleteLocalFavoriteGroup({
                kind,
                groupName: group.key
            });
            if (selectedSource === 'local' && selectedGroupKey === group.key) {
                setSelectedGroupKey('');
            }
            toast.success(
                t('view.favorite.generated.local_favorite_group_deleted')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.generated_toast.failed_to_delete_local_favorite_group'
                      )
            );
        }
    }
    return {
        refreshFavorites,
        handleSortValueChange,
        handleRemoveLocalFavorite,
        handleRemoveRemoteFavorite,
        exportCurrentFavorites,
        handleRemoteGroupRename,
        handleRemoteGroupVisibility,
        handleRemoteGroupClear,
        handleLocalGroupRename,
        handleLocalGroupDelete
    };
}
