export function useGameLogPageActions({
    canDeleteGameLogRow,
    clampGameLogSessionDateInputRange,
    configRepository,
    confirm,
    copyTextToClipboard,
    deletingGameLogKey,
    describeGameLogDetail,
    gameLogRepository,
    getGameLogCopyTarget,
    getGameLogRowKey,
    isoToGameLogDateInputValue,
    loadingPreviousInstancesKey,
    normalizeId,
    resolveWorldId,
    searchDraft,
    sessionDateDraftFrom,
    sessionDateDraftTo,
    sessionDateFrom,
    sessionDateTo,
    setActiveFavoritesOnly,
    setDeletingGameLogKey,
    setLoadingPreviousInstancesKey,
    setPreviousInstancesOpen,
    setPreviousInstancesRows,
    setPreviousInstancesTitle,
    setRefreshToken,
    setRows,
    setSavedViewMode,
    setSearchDraft,
    setSearchQuery,
    setSessionDateDraftFrom,
    setSessionDateDraftTo,
    setSessionDateFrom,
    setSessionDatePopoverOpen,
    setSessionDateTo,
    t,
    toGameLogDateInputValue,
    toGameLogIsoRangeEnd,
    toGameLogIsoRangeStart,
    toast
}) {
    async function deleteGameLogRow(row, { skipConfirm = false } = {}) {
        if (!canDeleteGameLogRow(row)) {
            return;
        }
        const rowKey = getGameLogRowKey(row);
        if (!rowKey || deletingGameLogKey) {
            return;
        }
        if (!skipConfirm) {
            const detailValue = describeGameLogDetail(row);
            const result = await confirm({
                title: t('view.game_log.generated_modal.delete_game_log_row'),
                description: detailValue.primary || row.type || row.created_at,
                confirmText: t('common.actions.delete'),
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
        }
        setDeletingGameLogKey(rowKey);
        try {
            await gameLogRepository.deleteGameLogEntry(row);
            setRows((currentRows) =>
                currentRows.filter(
                    (entry) => getGameLogRowKey(entry) !== rowKey
                )
            );
            toast.success(t('view.game_log.generated.game_log_row_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.game_log.generated_toast.failed_to_delete_game_log_row'
                      )
            );
        } finally {
            setDeletingGameLogKey('');
        }
    }
    async function openPreviousInstancesForRow(row) {
        const rowKey = getGameLogRowKey(row);
        const worldId = resolveWorldId(row);
        if (!worldId || loadingPreviousInstancesKey) {
            return;
        }
        setLoadingPreviousInstancesKey(rowKey || worldId);
        try {
            const instances =
                await gameLogRepository.getPreviousInstancesByWorldId({
                    worldId
                });
            const currentLocation = normalizeId(row?.location);
            const sortedInstances = [...instances].sort((left, right) => {
                if (currentLocation) {
                    if (normalizeId(left?.location) === currentLocation) {
                        return -1;
                    }
                    if (normalizeId(right?.location) === currentLocation) {
                        return 1;
                    }
                }
                return (
                    Date.parse(right?.created_at || 0) -
                    Date.parse(left?.created_at || 0)
                );
            });
            setPreviousInstancesRows(sortedInstances);
            setPreviousInstancesTitle(
                `Instance History - ${row?.worldName || 'World'}`
            );
            setPreviousInstancesOpen(true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.game_log.generated_toast.failed_to_load_instance_history'
                      )
            );
        } finally {
            setLoadingPreviousInstancesKey('');
        }
    }
    async function copyGameLogDetail(row) {
        const text = getGameLogCopyTarget(row);
        if (!text) {
            return;
        }
        await copyTextToClipboard(text);
        toast.success(t('view.game_log.generated.copied_game_log_detail'));
    }
    function commitSearchDraft() {
        setSearchQuery(searchDraft);
    }
    function syncSessionDateDraft() {
        setSessionDateDraftFrom(isoToGameLogDateInputValue(sessionDateFrom));
        setSessionDateDraftTo(isoToGameLogDateInputValue(sessionDateTo));
    }
    function updateSessionDateDraftRange(range) {
        const nextFrom = toGameLogDateInputValue(range?.from);
        const nextTo = toGameLogDateInputValue(range?.to);
        if (!nextFrom || !nextTo) {
            setSessionDateDraftFrom(nextFrom);
            setSessionDateDraftTo(nextTo);
            return;
        }
        const [clampedFrom, clampedTo] = clampGameLogSessionDateInputRange(
            nextFrom,
            nextTo
        );
        setSessionDateDraftFrom(clampedFrom);
        setSessionDateDraftTo(clampedTo);
    }
    function applySessionDateRange() {
        if (!sessionDateDraftFrom && !sessionDateDraftTo) {
            setSessionDateFrom('');
            setSessionDateTo('');
            setSessionDatePopoverOpen(false);
            return;
        }
        const [fromInput, toInput] = clampGameLogSessionDateInputRange(
            sessionDateDraftFrom || sessionDateDraftTo,
            sessionDateDraftTo || sessionDateDraftFrom
        );
        setSessionDateDraftFrom(fromInput);
        setSessionDateDraftTo(toInput);
        setSessionDateFrom(toGameLogIsoRangeStart(fromInput));
        setSessionDateTo(toGameLogIsoRangeEnd(toInput));
        setSessionDatePopoverOpen(false);
    }
    function clearSessionDateRange() {
        setSessionDateDraftFrom('');
        setSessionDateDraftTo('');
        setSessionDateFrom('');
        setSessionDateTo('');
        setSessionDatePopoverOpen(false);
    }
    function changeViewMode(nextViewMode) {
        setSavedViewMode(nextViewMode);
        void configRepository.setString('gameLogViewMode', nextViewMode);
    }
    function toggleFavoritesOnly() {
        setActiveFavoritesOnly((current) => !current);
    }
    function handleSessionDatePopoverChange(open) {
        if (open) {
            syncSessionDateDraft();
        }
        setSessionDatePopoverOpen(open);
    }
    function clearSearch() {
        setSearchDraft('');
        setSearchQuery('');
    }
    function refreshGameLog() {
        setRefreshToken((value) => value + 1);
    }
    return {
        deleteGameLogRow,
        openPreviousInstancesForRow,
        copyGameLogDetail,
        commitSearchDraft,
        updateSessionDateDraftRange,
        applySessionDateRange,
        clearSessionDateRange,
        changeViewMode,
        toggleFavoritesOnly,
        handleSessionDatePopoverChange,
        clearSearch,
        refreshGameLog
    };
}
