export function useFavoritesBulkActions({
    confirm,
    handleRemoveLocalFavorite,
    handleRemoveRemoteFavorite,
    selectedContentItems,
    setEditMode,
    setSelectedKeys,
    t,
    toast
}) {
    async function bulkRemoveSelection() {
        if (!selectedContentItems.length) {
            return;
        }
        const result = await confirm({
            title: t('view.favorites.generated_modal.delete_value_favorites', {
                value: selectedContentItems.length
            }),
            description: t(
                'view.favorites.generated_modal.this_action_cannot_be_undone'
            ),
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
            toast.success(
                t('view.favorite.generated.selected_favorites_removed')
            );
            return;
        }
        toast.error(
            t('view.favorites.generated_dynamic.removed_value_value_failed', {
                value: removedCount,
                value2: failedCount
            })
        );
    }
    return {
        bulkRemoveSelection
    };
}
