import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type {
    FavoriteTransferItemResult,
    FavoriteTransferMode
} from '@/platform/tauri/bindings';
import favoriteTransferRepository from '@/repositories/favoriteTransferRepository';
import type { FavoriteRecord } from '@/state/favoriteStoreTypes';
import { useModalStore } from '@/state/modalStore';

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
    handleRemoveLocalFavorite,
    handleRemoveRemoteFavorite,
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
    handleRemoveLocalFavorite(
        item: FavoriteItem,
        options?: { silent?: boolean }
    ): Promise<boolean>;
    handleRemoveRemoteFavorite(
        item: FavoriteItem,
        options?: { silent?: boolean }
    ): Promise<boolean>;
    kind: FavoriteKind;
    localGroups: FavoriteGroup[];
    refreshFavorites(options?: { silent?: boolean }): Promise<void>;
    remoteFavoritesByObjectId: Record<string, FavoriteRecord | undefined>;
    remoteGroups: FavoriteGroup[];
    selectedContentItems: FavoriteItem[];
    selectedGroupKey: string;
    selectedSource: FavoriteSource;
    setSelectedKeys(value: string[] | ((current: string[]) => string[])): void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
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
        if (!selectedContentItems.length) {
            return;
        }
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
        let removedCount = 0;
        let failedCount = 0;
        const removedKeys = new Set<string>();
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
            toast.success(
                t('view.favorite.success.selected_favorites_removed')
            );
            return;
        }
        toast.error(
            t('view.favorites.dynamic.removed_value_value_failed', {
                value: removedCount,
                value2: failedCount
            })
        );
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
