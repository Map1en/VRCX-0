import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useFavoritesVirtualGrid } from '../useFavoritesVirtualGrid';
import { FavoriteCard } from './FavoriteCard';
import { FavoritesContentHeader } from './FavoritesContentHeader';
import { GroupRailSection } from './FavoritesGroupRail';
import {
    FavoritesEmptyState,
    FavoritesLoadingState
} from './FavoritesStateParts';

function getFavoriteSearchResultsSubtitle(t: any, count: any) {
    return t(
        count === 1
            ? 'view.favorites.dynamic.search_results_singular'
            : 'view.favorites.dynamic.search_results_plural',
        { count }
    );
}

function useStableEvent(handler: any) {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    return useCallback((...args: any[]) => handlerRef.current?.(...args), []);
}

export function FavoritesGroupRailPanel({
    collections,
    creatingLocalGroup,
    favoriteCommands,
    filters,
    kind,
    newLocalGroupName,
    onNewGroupNameChange,
    setCreatingLocalGroup,
    viewData
}: any) {
    const { t } = useTranslation();
    const activeSource = viewData.hasSearchInput ? '' : filters.selectedSource;
    const activeGroupKey = viewData.hasSearchInput
        ? ''
        : filters.selectedGroupKey;
    const remoteLoading =
        collections.favoriteLoadStatus === 'running' ||
        favoriteCommands.refreshing;

    const selectGroup = useStableEvent((group: any) => {
        filters.setSearchQuery('');
        filters.setSelectedSource(group.source);
        filters.setSelectedGroupKey(group.key);
    });

    const startCreateLocalGroup = useStableEvent(() => {
        setCreatingLocalGroup(true);
        onNewGroupNameChange('');
    });

    const cancelCreateLocalGroup = useStableEvent(() => {
        setCreatingLocalGroup(false);
        onNewGroupNameChange('');
    });

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-2">
            <GroupRailSection
                title={viewData.pageConfig.remoteSectionTitle}
                groups={viewData.remoteGroups}
                selectedSource={activeSource}
                selectedGroupKey={activeGroupKey}
                loading={remoteLoading}
                onRefresh={favoriteCommands.refreshFavorites}
                onSelect={selectGroup}
                onRemoteRename={favoriteCommands.handleRemoteGroupRename}
                onRemoteVisibility={
                    favoriteCommands.handleRemoteGroupVisibility
                }
                onRemoteClear={favoriteCommands.handleRemoteGroupClear}
                onLocalRename={favoriteCommands.handleLocalGroupRename}
                onLocalDelete={favoriteCommands.handleLocalGroupDelete}
            />
            <GroupRailSection
                title={viewData.pageConfig.localSectionTitle}
                groups={viewData.localGroups}
                selectedSource={activeSource}
                selectedGroupKey={activeGroupKey}
                loading={favoriteCommands.refreshing}
                creating={creatingLocalGroup}
                newGroupName={newLocalGroupName}
                newGroupLabel={viewData.pageConfig.localNewGroupLabel}
                showNewGroup={viewData.canCreateLocalGroup}
                onRefresh={favoriteCommands.refreshFavorites}
                onSelect={selectGroup}
                onStartCreate={startCreateLocalGroup}
                onNewGroupNameChange={onNewGroupNameChange}
                onConfirmCreate={favoriteCommands.confirmCreateLocalGroup}
                onCancelCreate={cancelCreateLocalGroup}
                onRemoteRename={favoriteCommands.handleRemoteGroupRename}
                onRemoteVisibility={
                    favoriteCommands.handleRemoteGroupVisibility
                }
                onRemoteClear={favoriteCommands.handleRemoteGroupClear}
                onLocalRename={favoriteCommands.handleLocalGroupRename}
                onLocalDelete={favoriteCommands.handleLocalGroupDelete}
            />
            {kind === 'avatar' ? (
                <GroupRailSection
                    title={t('view.favorite.avatars.local_history')}
                    groups={viewData.avatarHistoryGroups}
                    selectedSource={activeSource}
                    selectedGroupKey={activeGroupKey}
                    loading={collections.avatarHistoryLoading}
                    onRefresh={favoriteCommands.refreshAvatarHistory}
                    onSelect={selectGroup}
                    onRemoteRename={favoriteCommands.handleRemoteGroupRename}
                    onRemoteVisibility={
                        favoriteCommands.handleRemoteGroupVisibility
                    }
                    onRemoteClear={favoriteCommands.handleRemoteGroupClear}
                    onLocalRename={favoriteCommands.handleLocalGroupRename}
                    onLocalDelete={favoriteCommands.handleLocalGroupDelete}
                    onHistoryClear={favoriteCommands.handleAvatarHistoryClear}
                />
            ) : null}
        </div>
    );
}

export function FavoritesContentPanel({
    collections,
    favoriteCommands,
    filters,
    kind,
    layout,
    selection,
    viewData
}: any) {
    const { t } = useTranslation();
    const remoteDetails = collections.remoteEntityDetails || {};
    const remoteDetailsData = remoteDetails.data || {};
    const isRemoteDetailsLoading =
        kind !== 'friend' &&
        remoteDetails.status === 'running' &&
        !Object.keys(remoteDetailsData).length &&
        filters.selectedSource === 'remote';
    const virtualGrid = useFavoritesVirtualGrid({
        cardScale: layout.cardScale,
        cardSpacing: layout.cardSpacing,
        items: viewData.contentItems,
        resetKey: [
            kind,
            filters.selectedSource,
            filters.selectedGroupKey,
            filters.searchMode,
            filters.searchQuery,
            layout.sortValue
        ].join(':'),
        showGroupLabel: viewData.isSearchActive
    });
    const editModeDisabled =
        viewData.isSearchActive ||
        !viewData.selectedGroup ||
        viewData.contentItems.length === 0 ||
        selection.avatarEditSelectionDisabled;
    const title = viewData.isSearchActive
        ? viewData.pageConfig.searchPlaceholder
        : viewData.selectedGroup
          ? viewData.selectedGroup.label
          : t('view.favorites.empty.no_group_selected');
    const subtitle = viewData.isSearchActive
        ? getFavoriteSearchResultsSubtitle(t, viewData.contentItems.length)
        : viewData.selectedGroup
          ? viewData.selectedGroup.capacity
              ? `${viewData.selectedGroup.count}/${viewData.selectedGroup.capacity}`
              : String(viewData.selectedGroup.count)
          : '';

    const handleEditModeChange = useStableEvent((value: any) => {
        selection.setEditMode(value);
        if (!value) {
            selection.setSelectedKeys([]);
        }
    });

    const handleToggleSelect = useStableEvent((itemKey: any, checked: any) => {
        selection.setSelectedKeys((keys: any) =>
            checked
                ? Array.from(new Set([...keys, itemKey]))
                : keys.filter((key: any) => key !== itemKey)
        );
    });
    const handleClearSelection = useStableEvent(() =>
        selection.setSelectedKeys([])
    );
    const handleCopySelection = useStableEvent(favoriteCommands.copySelection);
    const handleBulkRemoveSelection = useStableEvent(
        favoriteCommands.bulkRemoveSelection
    );
    const handleCardRemoveLocalFavorite = useStableEvent(
        favoriteCommands.handleRemoveLocalFavorite
    );
    const handleCardRemoveRemoteFavorite = useStableEvent(
        favoriteCommands.handleRemoveRemoteFavorite
    );
    const handleCardFriendLaunch = useStableEvent(
        favoriteCommands.launchFavoriteFriendLocation
    );
    const handleCardFriendSelfInvite = useStableEvent(
        favoriteCommands.selfInviteFavoriteFriendLocation
    );
    const handleCardFriendInvite = useStableEvent(
        favoriteCommands.sendFavoriteFriendInvite
    );
    const handleCardFriendRequestInvite = useStableEvent(
        favoriteCommands.requestFavoriteFriendInvite
    );
    const handleCardFriendBoop = useStableEvent(
        favoriteCommands.sendFavoriteFriendBoop
    );
    const handleCardWorldNewInstance = useStableEvent((entry: any) =>
        favoriteCommands.openWorldNewInstance(entry, false)
    );
    const handleCardWorldSelfInvite = useStableEvent((entry: any) =>
        favoriteCommands.openWorldNewInstance(entry, true)
    );
    const handleCardAvatarSelect = useStableEvent(
        favoriteCommands.selectFavoriteAvatar
    );

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col pl-[26px]">
            <FavoritesContentHeader
                title={title}
                subtitle={subtitle}
                editMode={selection.editMode}
                editModeDisabled={editModeDisabled}
                editModeVisible={
                    selection.editMode &&
                    !viewData.isSearchActive &&
                    !selection.avatarEditSelectionDisabled
                }
                isAllSelected={selection.isAllSelected}
                hasSelection={selection.selectedKeysSet.size > 0}
                showCopyButton={filters.selectedSource !== 'local'}
                onEditModeChange={handleEditModeChange}
                onToggleSelectAll={selection.toggleSelectAll}
                onClearSelection={handleClearSelection}
                onCopySelection={handleCopySelection}
                onBulkRemove={handleBulkRemoveSelection}
            />
            <div
                ref={virtualGrid.viewportRef}
                className="min-h-0 min-w-0 flex-1 overflow-auto pr-2"
            >
                {collections.favoriteLoadStatus === 'running' &&
                !viewData.contentItems.length ? (
                    <FavoritesLoadingState
                        title={t(
                            'view.favorite.loading.loading_favorites_baseline'
                        )}
                    />
                ) : collections.favoriteLoadStatus === 'error' ? (
                    <FavoritesEmptyState
                        title={t(
                            'view.favorite.error.favorites_failed_to_load'
                        )}
                        description={
                            collections.favoriteDetail ||
                            t(
                                'view.favorite.label.the_favorites_baseline_did_not_finish_loading'
                            )
                        }
                    />
                ) : isRemoteDetailsLoading ? (
                    <FavoritesLoadingState
                        title={
                            kind === 'avatar'
                                ? t(
                                      'view.favorite.loading.loading_remote_avatar_details'
                                  )
                                : t(
                                      'view.favorite.loading.loading_remote_world_details'
                                  )
                        }
                    />
                ) : !viewData.contentItems.length ? (
                    <FavoritesEmptyState
                        title={
                            viewData.isSearchActive
                                ? t('common.no_matching_records')
                                : t('common.no_data')
                        }
                        description={
                            viewData.isSearchActive
                                ? t(
                                      'view.favorite.label.try_a_different_search_term'
                                  )
                                : t(
                                      'view.favorite.empty.the_selected_group_currently_has_no_items'
                                  )
                        }
                    />
                ) : (
                    <div
                        className="relative min-w-0"
                        style={{
                            height: `${virtualGrid.totalHeight}px`
                        }}
                    >
                        {virtualGrid.visibleRows.map((row: any) => (
                            <div
                                key={row.key}
                                className="absolute right-0 left-0 grid min-w-0"
                                style={{
                                    gap: `${virtualGrid.gridGap}px`,
                                    height: `${row.cardHeight}px`,
                                    gridTemplateColumns: `repeat(${virtualGrid.gridColumnCount}, minmax(${virtualGrid.gridMinWidth}px, 1fr))`,
                                    transform: `translateY(${row.top}px)`
                                }}
                            >
                                {row.items.map((item: any) => (
                                    <FavoriteCard
                                        key={item.key}
                                        item={item}
                                        editMode={
                                            selection.editMode &&
                                            !viewData.isSearchActive
                                        }
                                        selected={selection.selectedKeysSet.has(
                                            item.key
                                        )}
                                        showGroupLabel={viewData.isSearchActive}
                                        cardScale={layout.cardScale}
                                        cardHeight={row.cardHeight}
                                        cardSpacing={layout.cardSpacing}
                                        removing={
                                            favoriteCommands.removingFavoriteKey ===
                                            item.key
                                        }
                                        onToggleSelect={handleToggleSelect}
                                        onRemoveLocal={
                                            handleCardRemoveLocalFavorite
                                        }
                                        onRemoveRemote={
                                            handleCardRemoveRemoteFavorite
                                        }
                                        onFriendLaunch={handleCardFriendLaunch}
                                        onFriendSelfInvite={
                                            handleCardFriendSelfInvite
                                        }
                                        onFriendInvite={handleCardFriendInvite}
                                        onFriendRequestInvite={
                                            handleCardFriendRequestInvite
                                        }
                                        onFriendBoop={handleCardFriendBoop}
                                        onWorldNewInstance={
                                            handleCardWorldNewInstance
                                        }
                                        onWorldSelfInvite={
                                            handleCardWorldSelfInvite
                                        }
                                        onAvatarSelect={handleCardAvatarSelect}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
