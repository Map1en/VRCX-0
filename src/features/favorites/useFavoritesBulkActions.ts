import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type {
    FavoriteBulkRemoveResult,
    FavoriteTransferItemResult,
    FavoriteTransferMode
} from '@/platform/tauri/bindings';
import { commands } from '@/platform/tauri/bindings';
import favoriteTransferRepository from '@/repositories/favoriteTransferRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import type { FavoriteRecord } from '@/state/favoriteStoreTypes';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    buildFavoriteBulkRemoveInput,
    favoriteBulkRemoveSuccessfulKeys
} from './favoriteBulkRemove';

const FAVORITE_BULK_REMOVE_CHUNK_SIZE = 250;
import type {
    FavoriteGroup,
    FavoriteItem,
    FavoriteKind,
    FavoriteSource
} from './favoritesTypes';
import {
    buildFavoriteCopyTargets,
    buildFavoriteMoveTargets,
    buildFavoriteTransferFailureDescription,
    buildFavoriteTransferInput,
    buildFavoriteTransferSuccessfulKeys,
    FAVORITE_TRANSFER_RECOVERED_GROUP_NAME,
    groupFavoriteItemsBySourceGroup,
    resolveFavoriteSourceGroup,
    summarizeFavoriteTransferStatuses
} from './favoriteTransfer';

export function useFavoritesBulkActions({
    currentEndpoint,
    kind,
    localGroups,
    refreshFavorites,
    remoteFavoritesByObjectId,
    remoteGroups,
    selectedContentItems,
    selectedGroupKey,
    selectedSource,
    setSelectedKeys
}: {
    currentEndpoint: string;
    kind: FavoriteKind;
    localGroups: FavoriteGroup[];
    refreshFavorites(options?: { silent?: boolean }): Promise<boolean>;
    remoteFavoritesByObjectId: Record<string, FavoriteRecord | undefined>;
    remoteGroups: FavoriteGroup[];
    selectedContentItems: FavoriteItem[];
    selectedGroupKey: string;
    selectedSource: FavoriteSource;
    setSelectedKeys(value: string[] | ((current: string[]) => string[])): void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const removeLocalFavorite = useFavoriteStore(
        (state) => state.removeLocalFavorite
    );
    const removeRemoteFavorite = useFavoriteStore(
        (state) => state.removeRemoteFavorite
    );
    const moveTargets = useMemo(
        () =>
            buildFavoriteMoveTargets({
                remoteGroups,
                localGroups,
                selectedSource,
                selectedGroupKey,
                selectedItems: selectedContentItems,
                remoteFavoritesByObjectId
            }),
        [
            localGroups,
            remoteFavoritesByObjectId,
            remoteGroups,
            selectedContentItems,
            selectedGroupKey,
            selectedSource
        ]
    );
    const copyTargets = useMemo(
        () =>
            buildFavoriteCopyTargets({
                remoteGroups,
                localGroups,
                selectedSource,
                selectedGroupKey,
                selectedItems: selectedContentItems,
                remoteFavoritesByObjectId
            }),
        [
            localGroups,
            remoteFavoritesByObjectId,
            remoteGroups,
            selectedContentItems,
            selectedGroupKey,
            selectedSource
        ]
    );

    async function bulkRemoveSelection() {
        if (!currentUserId || !selectedContentItems.length) {
            return;
        }
        const batchOwnerUserId = currentUserId;
        const batchEndpoint = currentEndpoint;
        const result = await confirm({
            title: t('view.favorites.modal.delete_value_favorites', {
                value: selectedContentItems.length
            }),
            description: t('view.favorites.modal.this_action_cannot_be_undone'),
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            const batchResult: FavoriteBulkRemoveResult = {
                ownerUserId: batchOwnerUserId,
                kind,
                total: 0,
                succeeded: 0,
                failed: 0,
                localChanged: false,
                remoteChanged: false,
                items: [],
                lastError: null
            };
            for (
                let start = 0;
                start < selectedContentItems.length;
                start += FAVORITE_BULK_REMOVE_CHUNK_SIZE
            ) {
                const chunkResult = await commands.appFavoritesBulkRemove(
                    buildFavoriteBulkRemoveInput({
                        expectedEndpoint: currentEndpoint,
                        expectedOwnerUserId: batchOwnerUserId,
                        items: selectedContentItems.slice(
                            start,
                            start + FAVORITE_BULK_REMOVE_CHUNK_SIZE
                        ),
                        kind
                    })
                );
                batchResult.ownerUserId = chunkResult.ownerUserId;
                batchResult.total += chunkResult.total;
                batchResult.succeeded += chunkResult.succeeded;
                batchResult.failed += chunkResult.failed;
                batchResult.localChanged =
                    batchResult.localChanged || chunkResult.localChanged;
                batchResult.remoteChanged =
                    batchResult.remoteChanged || chunkResult.remoteChanged;
                batchResult.items.push(...chunkResult.items);
                batchResult.lastError =
                    chunkResult.lastError ?? batchResult.lastError;
                const chunkAuth = useRuntimeStore.getState().auth;
                if (
                    chunkAuth.currentUserId !== chunkResult.ownerUserId ||
                    chunkAuth.currentUserEndpoint !== batchEndpoint
                ) {
                    break;
                }
            }
            const removedKeys = favoriteBulkRemoveSuccessfulKeys(batchResult);
            const currentAuth = useRuntimeStore.getState().auth;
            if (
                currentAuth.currentUserId !== batchResult.ownerUserId ||
                currentAuth.currentUserEndpoint !== batchEndpoint
            ) {
                return;
            }
            if (removedKeys.size) {
                const itemsByKey = new Map(
                    selectedContentItems.map((item) => [item.key, item])
                );
                for (const key of removedKeys) {
                    const item = itemsByKey.get(key);
                    if (!item) {
                        continue;
                    }
                    if (item.source === 'local') {
                        removeLocalFavorite({
                            kind: item.kind,
                            entityId: item.id,
                            groupName: item.groupKey
                        });
                    } else {
                        removeRemoteFavorite(item.id);
                    }
                }
                setSelectedKeys((current) =>
                    current.filter((key) => !removedKeys.has(key))
                );
            }
            if (batchResult.failed === 0) {
                toast.success(
                    t('view.favorite.success.selected_favorites_removed')
                );
                return;
            }
            toast.error(
                t('view.favorites.dynamic.removed_value_value_failed', {
                    value: batchResult.succeeded,
                    value2: batchResult.failed
                })
            );
        } catch (error) {
            const currentAuth = useRuntimeStore.getState().auth;
            if (
                currentAuth.currentUserId !== batchOwnerUserId ||
                currentAuth.currentUserEndpoint !== batchEndpoint
            ) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.dynamic.removed_value_value_failed', {
                          value: 0,
                          value2: selectedContentItems.length
                      })
            );
        }
    }

    function describeFavoriteTransferNotices(
        summary: ReturnType<typeof summarizeFavoriteTransferStatuses>
    ): string[] {
        const notices: string[] = [];
        if (summary.restoredToSource > 0) {
            notices.push(
                t(
                    'view.favorites.dynamic.restored_value_to_source_after_failed_move',
                    { value: summary.restoredToSource }
                )
            );
        }
        if (summary.savedToLocalFallback > 0) {
            notices.push(
                t(
                    'view.favorites.dynamic.saved_value_to_local_fallback_group',
                    {
                        value: summary.savedToLocalFallback,
                        value2: FAVORITE_TRANSFER_RECOVERED_GROUP_NAME
                    }
                )
            );
        }
        if (summary.targetAddedSourceDeleteFailed > 0) {
            notices.push(
                t(
                    'view.favorites.dynamic.target_added_value_source_delete_failed',
                    { value: summary.targetAddedSourceDeleteFailed }
                )
            );
        }
        if (summary.skippedAlreadyPresent > 0) {
            notices.push(
                t('view.favorites.dynamic.skipped_value_already_present', {
                    value: summary.skippedAlreadyPresent
                })
            );
        }
        return notices;
    }

    async function bulkTransferSelection(
        targetGroup: FavoriteGroup,
        mode: FavoriteTransferMode
    ) {
        if (!selectedContentItems.length) {
            return;
        }
        const batches = groupFavoriteItemsBySourceGroup(selectedContentItems);
        let succeeded = 0;
        let failed = 0;
        const successfulKeys = new Set<string>();
        const allResults: FavoriteTransferItemResult[] = [];
        let thrownErrorMessage = '';

        for (const batchItems of batches) {
            const sourceGroup = resolveFavoriteSourceGroup({
                item: batchItems[0],
                remoteGroups,
                localGroups
            });
            try {
                const result =
                    await favoriteTransferRepository.transferFavorites(
                        buildFavoriteTransferInput({
                            endpoint: currentEndpoint,
                            kind,
                            mode,
                            sourceGroup,
                            targetGroup,
                            selectedItems: batchItems
                        })
                    );
                succeeded += result.succeeded;
                failed += result.failed;
                for (const key of buildFavoriteTransferSuccessfulKeys(
                    result.items
                )) {
                    successfulKeys.add(key);
                }
                allResults.push(...result.items);
            } catch (error) {
                failed += batchItems.length;
                if (!thrownErrorMessage && error instanceof Error) {
                    thrownErrorMessage = error.message;
                }
            }
        }

        if (succeeded > 0) {
            await refreshFavorites({ silent: true });
            setSelectedKeys((current) =>
                current.filter((key) => !successfulKeys.has(key))
            );
        }

        const summary = summarizeFavoriteTransferStatuses(allResults);
        const notices = describeFavoriteTransferNotices(summary);
        const noticeDescription = notices.join('\n');
        const successMessage =
            mode === 'copy'
                ? t('view.favorites.dynamic.copied_value_favorites', {
                      value: summary.succeeded
                  })
                : t('view.favorites.dynamic.moved_value_favorites', {
                      value: summary.succeeded
                  });

        if (failed === 0 && notices.length === 0) {
            toast.success(successMessage);
            return;
        }

        if (failed === 0) {
            toast.warning(
                successMessage,
                noticeDescription
                    ? { description: noticeDescription }
                    : undefined
            );
            return;
        }

        const fallbackMessage =
            thrownErrorMessage ||
            t('view.favorites.toast.failed_to_move_selected_favorites');
        const failureDescription = buildFavoriteTransferFailureDescription({
            results: allResults.filter((item) => item.status === 'failed'),
            selectedItems: selectedContentItems,
            fallbackMessage
        });
        const combinedDescription = [noticeDescription, failureDescription]
            .filter(Boolean)
            .join('\n');
        toast.error(
            t('view.favorites.dynamic.transferred_value_value_failed', {
                value: succeeded,
                value2: failed
            }),
            combinedDescription
                ? { description: combinedDescription }
                : undefined
        );
    }

    function bulkMoveSelection(targetGroup: FavoriteGroup) {
        return bulkTransferSelection(targetGroup, 'move');
    }

    function bulkCopySelection(targetGroup: FavoriteGroup) {
        return bulkTransferSelection(targetGroup, 'copy');
    }

    return {
        bulkCopySelection,
        bulkMoveSelection,
        bulkRemoveSelection,
        copyTargets,
        moveTargets
    };
}
