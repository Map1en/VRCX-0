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
    useRuntimeStore,
    vrchatModerationRepository
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
            await vrchatModerationRepository.deletePlayerModeration({
                endpoint: currentEndpoint,
                moderated: row.targetUserId,
                type: row.type
            });
            if (useRuntimeStore.getState().auth.currentUserId !== ownerUserId) {
                return;
            }
            const nextRows = rows.filter(
                (entry) => !isSameModerationRow(entry, row)
            );
            setRows(nextRows);
            await vrchatModerationRepository.syncLocalModerationSnapshot({
                ownerUserId,
                rows: nextRows
            });
            setDetail(
                t('view.moderation.generated_dynamic.deleted_value_for_value', {
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
