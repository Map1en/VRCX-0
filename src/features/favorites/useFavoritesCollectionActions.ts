import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import avatarCacheRepository from '@/repositories/avatarCacheRepository';
import favoritePersistenceRepository from '@/repositories/favoritePersistenceRepository';
import vrchatFavoriteRepository from '@/repositories/vrchatFavoriteRepository';
import { bootstrapFavorites } from '@/services/favoriteBootstrapService';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useModalStore } from '@/state/modalStore';
import type { CurrentUserSnapshotState } from '@/state/runtimeStore';

import { favoriteGroupType } from './favoritesItems';
import type {
    FavoriteGroup,
    FavoriteItem,
    FavoriteKind,
    FavoriteSource
} from './favoritesTypes';

export function useFavoritesCollectionActions({
    allItems,
    currentEndpoint,
    currentUserId,
    currentUserSnapshot,
    kind,
    localGroups,
    refreshRemoteDetails,
    refreshing,
    removingFavoriteKeyRef,
    selectedGroupKey,
    selectedSource,
    setAvatarHistory,
    setExportDialogOpen,
    setRefreshing,
    setRemovingFavoriteKey,
    setSelectedGroupKey
}: {
    allItems: FavoriteItem[];
    currentEndpoint: string;
    currentUserId: string;
    currentUserSnapshot: CurrentUserSnapshotState | null;
    kind: FavoriteKind;
    localGroups: FavoriteGroup[];
    refreshRemoteDetails(): void;
    refreshing: boolean;
    removingFavoriteKeyRef: MutableRefObject<string>;
    selectedGroupKey: string;
    selectedSource: FavoriteSource;
    setAvatarHistory(
        value: unknown[] | ((current: unknown[]) => unknown[])
    ): void;
    setExportDialogOpen(value: boolean): void;
    setRefreshing(value: boolean): void;
    setRemovingFavoriteKey(value: string | ((current: string) => string)): void;
    setSelectedGroupKey(value: string): void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const removeLocalFavorite = useFavoriteStore(
        (state) => state.removeLocalFavorite
    );
    const removeRemoteFavorite = useFavoriteStore(
        (state) => state.removeRemoteFavorite
    );
    const renameLocalFavoriteGroup = useFavoriteStore(
        (state) => state.renameLocalFavoriteGroup
    );
    const deleteLocalFavoriteGroup = useFavoriteStore(
        (state) => state.deleteLocalFavoriteGroup
    );

    const refreshFavorites = async ({
        silent = false
    }: { silent?: boolean } = {}): Promise<boolean> => {
        if (refreshing) {
            return false;
        }
        if (!currentUserId || !currentUserSnapshot) {
            console.warn(
                'Favorites refresh skipped: no authenticated user context available.'
            );
            toast.error(
                t('view.favorites.toast.favorites_refresh_unavailable')
            );
            return false;
        }
        setRefreshing(true);
        try {
            refreshRemoteDetails();
            await bootstrapFavorites({
                userId: currentUserId,
                endpoint: currentEndpoint,
                currentUserSnapshot
            });
            if (kind === 'avatar') {
                const rows = await avatarCacheRepository.getAvatarHistory(
                    currentUserId,
                    100
                );
                setAvatarHistory(Array.isArray(rows) ? rows : []);
            }
            if (!silent) {
                toast.success(t('view.favorite.success.favorites_refreshed'));
            }
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_refresh_favorites')
            );
            return false;
        } finally {
            setRefreshing(false);
        }
    };

    const handleRemoveLocalFavorite = async (
        item: FavoriteItem,
        { silent = false }: { silent?: boolean } = {}
    ) => {
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
                title: t('view.favorites.modal.remove_local_favorite'),
                description: t(
                    'view.favorites.dynamic.remove_value_from_value',
                    {
                        value:
                            item.title ||
                            t('view.favorites.empty.favorite_fallback'),
                        value2:
                            item.groupLabel ||
                            t('view.favorites.empty.favorites_fallback')
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
            await favoritePersistenceRepository.removeLocalFavorite({
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
                    t('view.favorite.success.local_favorite_removed')
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
                    : t('view.favorites.toast.failed_to_remove_local_favorite')
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
        item: FavoriteItem,
        { silent = false }: { silent?: boolean } = {}
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
                title: t('view.favorites.modal.remove_vrchat_favorite'),
                description: t(
                    'view.favorites.dynamic.remove_value_from_value',
                    {
                        value:
                            item.title ||
                            t('view.favorites.empty.favorite_fallback'),
                        value2:
                            item.groupLabel ||
                            t('view.favorites.empty.favorites_fallback')
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
                objectId: item.id
            });
            removeRemoteFavorite(item.id);
            if (!silent) {
                toast.success(
                    t('view.favorite.success.vrchat_favorite_removed')
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
                    : t('view.favorites.toast.failed_to_remove_vrchat_favorite')
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
                t('view.favorite.empty.no_favorites_available_to_export')
            );
            return;
        }
        setExportDialogOpen(true);
    }

    async function handleRemoteGroupRename(group: FavoriteGroup) {
        const result = await prompt({
            title: t('view.favorites.modal.change_favorite_group_name'),
            description: t('view.favorites.modal.enter_the_new_display_name'),
            inputValue: group.label || group.name,
            pattern: /\S+/,
            confirmText: t('view.favorites.modal.change'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        const nextName = String(result.value ?? '').trim();
        if (!nextName || nextName === group.label) {
            return;
        }
        try {
            await vrchatFavoriteRepository.saveFavoriteGroup({
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name,
                displayName: nextName
            });
            await refreshFavorites();
            toast.success(t('view.favorite.label.favorite_group_renamed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_rename_favorite_group')
            );
        }
    }

    async function handleRemoteGroupVisibility(
        group: FavoriteGroup,
        visibility: string
    ) {
        if (group.visibility === visibility) {
            return;
        }
        try {
            await vrchatFavoriteRepository.saveFavoriteGroup({
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name,
                visibility
            });
            await refreshFavorites();
            toast.success(t('view.favorite.label.group_visibility_changed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.toast.failed_to_change_group_visibility'
                      )
            );
        }
    }

    async function handleRemoteGroupClear(group: FavoriteGroup) {
        const result = await confirm({
            title: t('view.favorites.modal.clear_favorite_group'),
            description: t(
                'view.favorites.modal.remove_all_favorites_from_this_group'
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
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name
            });
            await refreshFavorites();
            toast.success(t('view.favorite.success.favorite_group_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.toast.failed_to_clear_favorite_group')
            );
        }
    }

    async function handleLocalGroupRename(group: FavoriteGroup) {
        const result = await prompt({
            title: t('view.favorites.modal.rename_local_favorite_group'),
            description: t(
                'view.favorites.modal.enter_the_new_local_group_name'
            ),
            inputValue: group.label,
            pattern: /\S+/,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        const nextName = String(result.value ?? '').trim();
        if (!nextName || nextName === group.key) {
            return;
        }
        if (localGroups.some((localGroup) => localGroup.key === nextName)) {
            toast.error(
                t('view.favorites.dynamic.local_group_value_already_exists', {
                    value: nextName
                })
            );
            return;
        }
        try {
            await favoritePersistenceRepository.renameLocalFavoriteGroup({
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
                t('view.favorite.label.local_favorite_group_renamed')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.toast.failed_to_rename_local_favorite_group'
                      )
            );
        }
    }

    async function handleLocalGroupDelete(group: FavoriteGroup) {
        const result = await confirm({
            title: t('view.favorites.modal.delete_local_favorite_group'),
            description: t('view.favorites.modal.delete_value', {
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
            await favoritePersistenceRepository.deleteLocalFavoriteGroup({
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
                t('view.favorite.success.local_favorite_group_deleted')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.favorites.toast.failed_to_delete_local_favorite_group'
                      )
            );
        }
    }

    return {
        exportCurrentFavorites,
        handleLocalGroupDelete,
        handleLocalGroupRename,
        handleRemoveLocalFavorite,
        handleRemoveRemoteFavorite,
        handleRemoteGroupClear,
        handleRemoteGroupRename,
        handleRemoteGroupVisibility,
        refreshFavorites
    };
}
