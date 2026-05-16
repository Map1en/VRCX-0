import {
    refreshBackendModerations,
    updateBackendModeration
} from '@/services/backendModerationService.js';

export function useModerationPageActions({
    confirm,
    currentEndpoint,
    currentUserId,
    getModerationRowKey,
    isSameModerationRow,
    openUserDialog,
    rows,
    setDeletingModerationKey,
    setDetail,
    setRows,
    t,
    useRuntimeStore
}) {
    const handleDeleteModeration = async (
        row,
        { skipConfirm = false } = {}
    ) => {
        const ownerUserId = currentUserId;
        if (!ownerUserId || row?.sourceUserId !== ownerUserId) {
            return;
        }
        const result = skipConfirm
            ? {
                  ok: true
              }
            : await confirm({
                  title: t('common.actions.confirm'),
                  description: `Continue? Moderation ${row.type || ''}`.trim(),
                  destructive: true,
                  confirmText: t('common.actions.delete'),
                  cancelText: t('common.actions.cancel')
              });
        if (
            !result.ok ||
            useRuntimeStore.getState().auth.currentUserId !== ownerUserId
        ) {
            return;
        }
        const rowKey = getModerationRowKey(row);
        setDeletingModerationKey(rowKey);
        try {
            await updateBackendModeration({
                ownerUserId,
                endpoint: currentEndpoint,
                targetUserId: row.targetUserId,
                targetDisplayName: row.targetDisplayName || row.targetUserId,
                type: row.type,
                enabled: false
            });
            if (useRuntimeStore.getState().auth.currentUserId !== ownerUserId) {
                return;
            }
            const response = await refreshBackendModerations({
                userId: ownerUserId,
                endpoint: currentEndpoint
            });
            const nextRows = Array.isArray(response?.rows)
                ? response.rows
                : rows.filter((entry) => !isSameModerationRow(entry, row));
            setRows(nextRows);
            setDetail(
                t('view.moderation.dynamic.deleted_value_for_value', {
                    value: row.type || 'moderation',
                    value2: row.targetDisplayName || row.targetUserId
                })
            );
        } catch (error) {
            setDetail(
                error instanceof Error
                    ? error.message
                    : 'Failed to delete moderation.'
            );
        } finally {
            setDeletingModerationKey((currentKey) =>
                currentKey === rowKey ? '' : currentKey
            );
        }
    };
    function openModerationUser({ userId, title }) {
        if (!userId) {
            return;
        }
        openUserDialog({
            userId,
            title
        });
    }
    return {
        handleDeleteModeration,
        openModerationUser
    };
}
