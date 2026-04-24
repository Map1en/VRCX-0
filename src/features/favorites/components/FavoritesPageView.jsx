import { useCallback, useRef } from 'react';

import { useTranslation } from 'react-i18next';

import { FavoritesPageLayout } from './FavoritesPageLayout.jsx';

function useStableEvent(handler) {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    return useCallback((...args) => handlerRef.current?.(...args), []);
}

function getFavoriteSearchResultsSubtitle(t, count) {
    return t(
        count === 1
            ? 'view.favorites.generated_dynamic.search_results_singular'
            : 'view.favorites.generated_dynamic.search_results_plural',
        { count }
    );
}

export function FavoritesPageView({
    avatarEditSelectionDisabled,
    avatarHistoryGroups,
    avatarHistoryLoading,
    bulkRemoveSelection,
    canBoop,
    canCreateLocalGroup,
    canSendInvite,
    cardScale,
    cardSpacing,
    confirmCreateLocalGroup,
    contentItems,
    copySelection,
    creatingLocalGroup,
    currentAvatarId,
    currentUserId,
    editMode,
    embedded,
    exportCurrentFavorites,
    exportDialogOpen,
    favoriteDetail,
    favoriteLoadStatus,
    handleCardScaleChange,
    handleCardSpacingChange,
    handleLocalGroupDelete,
    handleLocalGroupRename,
    handleRemoveLocalFavorite,
    handleRemoveRemoteFavorite,
    handleRemoteGroupClear,
    handleRemoteGroupRename,
    handleRemoteGroupVisibility,
    hasSearchInput,
    isAllSelected,
    isSearchActive,
    kind,
    localGroups,
    localItemsByGroup,
    newLocalGroupName,
    onImportFavorites,
    openWorldNewInstance,
    pageConfig,
    persistSplitterLayout,
    refreshAvatarHistory,
    refreshFavorites,
    refreshing,
    remoteEntityDetails,
    remoteGroups,
    remoteItemsByGroup,
    removingFavoriteKey,
    requestFavoriteFriendInvite,
    searchMode,
    searchQuery,
    selectedGroup,
    selectedGroupKey,
    selectedKeysSet,
    selectedSource,
    selectFavoriteAvatar,
    selfInviteFavoriteFriendLocation,
    sendFavoriteFriendBoop,
    sendFavoriteFriendInvite,
    setCreatingLocalGroup,
    setEditMode,
    setExportDialogOpen,
    setNewLocalGroupName,
    setSearchMode,
    setSearchQuery,
    setSelectedGroupKey,
    setSelectedKeys,
    setSelectedSource,
    sortValue,
    splitterLayoutVersion,
    splitterSizePx,
    toggleSelectAll,
    handleSortValueChange,
    launchFavoriteFriendLocation,
    onHandleAvatarHistoryClear,
    onSplitterResize
}) {
    const { t } = useTranslation();

    const editModeDisabled =
        isSearchActive ||
        !selectedGroup ||
        contentItems.length === 0 ||
        avatarEditSelectionDisabled;
    const showCopyButton = selectedSource !== 'local';
    const hasSelection = selectedKeysSet.size > 0;
    const title = isSearchActive
        ? pageConfig.searchPlaceholder
        : selectedGroup
          ? selectedGroup.label
          : t('view.favorites.generated.no_group_selected');
    const subtitle = isSearchActive
        ? getFavoriteSearchResultsSubtitle(t, contentItems.length)
        : selectedGroup
          ? selectedGroup.capacity
              ? `${selectedGroup.count}/${selectedGroup.capacity}`
              : String(selectedGroup.count)
          : '';

    const handleCardToggleSelect = useStableEvent((itemKey, checked) => {
        setSelectedKeys((keys) =>
            checked
                ? Array.from(new Set([...keys, itemKey]))
                : keys.filter((key) => key !== itemKey)
        );
    });
    const handleEditModeChange = useStableEvent((value) => {
        setEditMode(value);
        if (!value) {
            setSelectedKeys([]);
        }
    });
    const handleClearSelection = useStableEvent(() => setSelectedKeys([]));
    const handleGroupRailRefresh = useStableEvent(() => refreshFavorites());
    const handleImportFavorites = useStableEvent(() => onImportFavorites());
    const handleExportFavorites = useStableEvent(() => exportCurrentFavorites());
    const handleGroupRailSelect = useStableEvent((group) => {
        setSearchQuery('');
        setSelectedSource(group.source);
        setSelectedGroupKey(group.key);
    });
    const handleStartCreateLocalGroup = useStableEvent(() => {
        setCreatingLocalGroup(true);
        setNewLocalGroupName('');
    });
    const handleCancelCreateLocalGroup = useStableEvent(() => {
        setCreatingLocalGroup(false);
        setNewLocalGroupName('');
    });
    const handleConfirmCreateLocalGroup = useStableEvent(
        confirmCreateLocalGroup
    );
    const handleAvatarHistoryRefresh = useStableEvent(refreshAvatarHistory);
    const handleAvatarHistoryClear = useStableEvent(onHandleAvatarHistoryClear);
    const handleRemoteGroupRenameEvent = useStableEvent(handleRemoteGroupRename);
    const handleRemoteGroupVisibilityEvent = useStableEvent(
        handleRemoteGroupVisibility
    );
    const handleRemoteGroupClearEvent = useStableEvent(handleRemoteGroupClear);
    const handleLocalGroupRenameEvent = useStableEvent(handleLocalGroupRename);
    const handleLocalGroupDeleteEvent = useStableEvent(handleLocalGroupDelete);
    const handleSplitterResize = useStableEvent(onSplitterResize);
    const handleSplitterLayout = useStableEvent(persistSplitterLayout);
    const handleCopySelection = useStableEvent(copySelection);
    const handleBulkRemoveSelection = useStableEvent(bulkRemoveSelection);
    const handleCardFriendLaunch = useStableEvent((entry) =>
        launchFavoriteFriendLocation(entry)
    );
    const handleCardFriendSelfInvite = useStableEvent((entry) =>
        selfInviteFavoriteFriendLocation(entry)
    );
    const handleCardFriendInvite = useStableEvent((entry) =>
        sendFavoriteFriendInvite(entry)
    );
    const handleCardFriendRequestInvite = useStableEvent((entry) =>
        requestFavoriteFriendInvite(entry)
    );
    const handleCardFriendBoop = useStableEvent((entry) =>
        sendFavoriteFriendBoop(entry)
    );
    const handleCardWorldNewInstance = useStableEvent((entry) =>
        openWorldNewInstance(entry, false)
    );
    const handleCardWorldSelfInvite = useStableEvent((entry) =>
        openWorldNewInstance(entry, true)
    );
    const handleCardAvatarSelect = useStableEvent((entry) =>
        selectFavoriteAvatar(entry)
    );
    const handleCardRemoveLocalFavorite = useStableEvent((entry) =>
        handleRemoveLocalFavorite(entry)
    );
    const handleCardRemoveRemoteFavorite = useStableEvent((entry) =>
        handleRemoveRemoteFavorite(entry)
    );

    return (
        <FavoritesPageLayout
            embedded={embedded}
            kind={kind}
            pageConfig={pageConfig}
            toolbar={{
                sortValue,
                searchQuery,
                searchMode,
                cardScale,
                cardSpacing,
                refreshing: refreshing || favoriteLoadStatus === 'running',
                onSortValueChange: handleSortValueChange,
                onSearchChange: setSearchQuery,
                onSearchModeChange: setSearchMode,
                onCardScaleChange: handleCardScaleChange,
                onCardSpacingChange: handleCardSpacingChange,
                onRefresh: handleGroupRailRefresh,
                onImport: handleImportFavorites,
                onExport: handleExportFavorites
            }}
            exportDialog={{
                open: exportDialogOpen,
                onOpenChange: setExportDialogOpen,
                remoteItemsByGroup,
                localItemsByGroup
            }}
            splitter={{
                layoutVersion: splitterLayoutVersion,
                sizePx: splitterSizePx,
                minSizePx: 0,
                contentMinSizePx: 320,
                onResize: handleSplitterResize,
                onLayoutChanged: handleSplitterLayout
            }}
            groupRail={{
                remoteTitle: pageConfig.remoteSectionTitle,
                localTitle: pageConfig.localSectionTitle,
                remoteGroups,
                localGroups,
                avatarHistoryGroups,
                selectedSource,
                selectedGroupKey,
                hasSearchInput,
                remoteLoading: favoriteLoadStatus === 'running' || refreshing,
                localLoading: refreshing,
                creatingLocalGroup,
                newLocalGroupName,
                canCreateLocalGroup,
                avatarHistoryLoading,
                onRefresh: handleGroupRailRefresh,
                onSelect: handleGroupRailSelect,
                onStartCreateLocalGroup: handleStartCreateLocalGroup,
                onNewGroupNameChange: setNewLocalGroupName,
                onConfirmCreateLocalGroup: handleConfirmCreateLocalGroup,
                onCancelCreateLocalGroup: handleCancelCreateLocalGroup,
                onRemoteRename: handleRemoteGroupRenameEvent,
                onRemoteVisibility: handleRemoteGroupVisibilityEvent,
                onRemoteClear: handleRemoteGroupClearEvent,
                onLocalRename: handleLocalGroupRenameEvent,
                onLocalDelete: handleLocalGroupDeleteEvent,
                onAvatarHistoryRefresh: handleAvatarHistoryRefresh,
                onAvatarHistoryClear: handleAvatarHistoryClear
            }}
            content={{
                title,
                subtitle,
                editMode,
                editModeDisabled,
                editModeVisible:
                    editMode && !isSearchActive && !avatarEditSelectionDisabled,
                isAllSelected,
                hasSelection,
                showCopyButton,
                favoriteLoadStatus,
                favoriteDetail,
                remoteEntityDetails,
                selectedSource,
                isSearchActive,
                items: contentItems,
                selectedKeysSet,
                cardScale,
                cardSpacing,
                removingFavoriteKey,
                canSendInvite,
                canBoop,
                currentUserId,
                currentAvatarId,
                onEditModeChange: handleEditModeChange,
                onToggleSelectAll: toggleSelectAll,
                onClearSelection: handleClearSelection,
                onCopySelection: handleCopySelection,
                onBulkRemove: handleBulkRemoveSelection,
                onToggleSelect: handleCardToggleSelect,
                onRemoveLocal: handleCardRemoveLocalFavorite,
                onRemoveRemote: handleCardRemoveRemoteFavorite,
                onFriendLaunch: handleCardFriendLaunch,
                onFriendSelfInvite: handleCardFriendSelfInvite,
                onFriendInvite: handleCardFriendInvite,
                onFriendRequestInvite: handleCardFriendRequestInvite,
                onFriendBoop: handleCardFriendBoop,
                onWorldNewInstance: handleCardWorldNewInstance,
                onWorldSelfInvite: handleCardWorldSelfInvite,
                onAvatarSelect: handleCardAvatarSelect
            }}
        />
    );
}
