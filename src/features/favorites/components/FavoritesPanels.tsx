import type { TFunction } from 'i18next';
import {
    CloudIcon,
    HardDriveIcon,
    HistoryIcon,
    Share2Icon
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isEditableTarget } from '@/components/layout/useGlobalKeyboardShortcuts';
import { Button } from '@/ui/shadcn/button';
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger
} from '@/ui/shadcn/popover';

import { getFavoritesDensityConfig } from '../favoritesDensity';
import type {
    FavoriteGroup,
    FavoriteItem,
    FavoriteKind
} from '../favoritesTypes';
import type { useFavoritesPageController } from '../useFavoritesPageController';
import { useFavoritesVirtualGrid } from '../useFavoritesVirtualGrid';
import { useStableEvent } from '../useStableEvent';
import { FavoriteCard } from './FavoriteCard';
import { GroupRailSection } from './FavoritesGroupRail';
import { FavoritesSelectionBar } from './FavoritesSelectionBar';
import {
    FavoritesEmptyState,
    FavoritesLoadingState
} from './FavoritesStateParts';

function getFavoriteSearchResultsSubtitle(t: TFunction, count: number) {
    return t(
        count === 1
            ? 'view.favorites.dynamic.search_results_singular'
            : 'view.favorites.dynamic.search_results_plural',
        { count }
    );
}

type FavoritesController = ReturnType<typeof useFavoritesPageController>;

type FavoritesGroupRailPanelProps = {
    collections: FavoritesController['collections'];
    creatingLocalGroup: boolean;
    favoriteCommands: FavoritesController['actions'];
    filters: FavoritesController['filters'];
    kind: FavoriteKind;
    newLocalGroupName: string;
    onNewGroupNameChange(value: string): void;
    onShareCollectionGroup?(group: FavoriteGroup): void;
    setCreatingLocalGroup: FavoritesController['setCreatingLocalGroup'];
    viewData: FavoritesController['viewData'];
};

type FavoritesContentPanelProps = {
    collections: FavoritesController['collections'];
    favoriteCommands: FavoritesController['actions'];
    filters: FavoritesController['filters'];
    kind: FavoriteKind;
    layout: FavoritesController['layout'];
    selection: FavoritesController['selection'];
    viewData: FavoritesController['viewData'];
    onShareCollectionGroup?(group: FavoriteGroup): void;
    shareCoachmarkOpen?: boolean;
    onDismissShareCoachmark?(): void;
    instanceActionGatesByItemKey: FavoritesController['instanceActionGatesByItemKey'];
};

type ShareCollectionButtonProps = {
    group: FavoriteGroup;
    coachmarkOpen: boolean;
    onShare(group: FavoriteGroup): void;
    onDismissCoachmark?(): void;
};

function ShareCollectionButton({
    group,
    coachmarkOpen,
    onShare,
    onDismissCoachmark
}: ShareCollectionButtonProps) {
    const { t } = useTranslation();

    return (
        <Popover
            open={coachmarkOpen}
            onOpenChange={(open) => {
                if (!open) {
                    onDismissCoachmark?.();
                }
            }}
        >
            <PopoverTrigger
                render={
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => onShare(group)}
                    >
                        <Share2Icon data-icon="inline-start" />
                        {t('view.favorite.share_collection.action.menu')}
                    </Button>
                }
            />
            <PopoverContent align="end" side="bottom">
                <PopoverHeader>
                    <PopoverTitle>
                        {t('view.favorite.share_collection.coachmark.title')}
                    </PopoverTitle>
                    <PopoverDescription>
                        {t(
                            'view.favorite.share_collection.coachmark.description'
                        )}
                    </PopoverDescription>
                </PopoverHeader>
                <div className="flex justify-end">
                    <Button
                        type="button"
                        size="sm"
                        onClick={onDismissCoachmark}
                    >
                        {t('view.favorite.share_collection.coachmark.dismiss')}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function FavoritesGroupRailPanel({
    collections,
    creatingLocalGroup,
    favoriteCommands,
    filters,
    kind,
    newLocalGroupName,
    onNewGroupNameChange,
    onShareCollectionGroup,
    setCreatingLocalGroup,
    viewData
}: FavoritesGroupRailPanelProps) {
    const { t } = useTranslation();
    const activeSource = viewData.hasSearchInput ? '' : filters.selectedSource;
    const activeGroupKey = viewData.hasSearchInput
        ? ''
        : filters.selectedGroupKey;
    const remoteLoading =
        collections.favoriteLoadStatus === 'running' ||
        favoriteCommands.refreshing;

    const selectGroup = useStableEvent((group: FavoriteGroup) => {
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
                icon={CloudIcon}
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
                onShareCollection={onShareCollectionGroup}
            />
            <GroupRailSection
                title={viewData.pageConfig.localSectionTitle}
                icon={HardDriveIcon}
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
                onShareCollection={onShareCollectionGroup}
            />
            {kind === 'avatar' ? (
                <GroupRailSection
                    title={t('view.favorite.avatars.local_history')}
                    icon={HistoryIcon}
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
    viewData,
    onShareCollectionGroup,
    shareCoachmarkOpen,
    onDismissShareCoachmark,
    instanceActionGatesByItemKey
}: FavoritesContentPanelProps) {
    const { t } = useTranslation();
    const remoteDetails = collections.remoteEntityDetails || {};
    const remoteDetailsData = remoteDetails.data || {};
    const isRemoteDetailsLoading =
        kind !== 'friend' &&
        remoteDetails.status === 'running' &&
        !Object.keys(remoteDetailsData).length &&
        filters.selectedSource === 'remote';
    const densityConfig = useMemo(
        () => getFavoritesDensityConfig(kind, layout.density),
        [kind, layout.density]
    );
    const virtualGrid = useFavoritesVirtualGrid({
        densityConfig,
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
    const showCopyIdsButton = selection.selectedContentItems.length > 0;
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

    const handleToggleSelect = useStableEvent(
        (itemKey: string, checked: boolean, shift: boolean) => {
            selection.selectItem(itemKey, checked, { shift });
        }
    );
    const handleClearSelection = useStableEvent(() =>
        selection.clearSelection()
    );
    const handleEscapeKeyDown = useStableEvent((event: KeyboardEvent) => {
        if (event.key !== 'Escape' || isEditableTarget(event.target)) {
            return;
        }
        selection.clearSelection();
    });
    const handleCopyIds = useStableEvent(favoriteCommands.copySelection);
    const handleCopySelection = useStableEvent(
        favoriteCommands.bulkCopySelection
    );
    const handleMoveSelection = useStableEvent(
        favoriteCommands.bulkMoveSelection
    );
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
    const handleCardWorldNewInstance = useStableEvent((entry: FavoriteItem) =>
        favoriteCommands.openWorldNewInstance(entry, false)
    );
    const handleCardWorldSelfInvite = useStableEvent((entry: FavoriteItem) =>
        favoriteCommands.openWorldNewInstance(entry, true)
    );
    const handleCardAvatarSelect = useStableEvent(
        favoriteCommands.selectFavoriteAvatar
    );

    useEffect(() => {
        if (!selection.hasSelection) {
            return;
        }
        window.addEventListener('keydown', handleEscapeKeyDown);
        return () => window.removeEventListener('keydown', handleEscapeKeyDown);
    }, [selection.hasSelection, handleEscapeKeyDown]);

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col pl-[26px]">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3 pl-0.5">
                <div className="flex min-w-0 flex-col gap-0.5 text-base font-semibold">
                    <span className="truncate">{title}</span>
                    {subtitle ? (
                        <small className="text-muted-foreground truncate text-xs font-normal">
                            {subtitle}
                        </small>
                    ) : null}
                </div>
                {kind === 'world' &&
                viewData.selectedGroup &&
                onShareCollectionGroup ? (
                    <ShareCollectionButton
                        group={viewData.selectedGroup}
                        coachmarkOpen={Boolean(shareCoachmarkOpen)}
                        onShare={onShareCollectionGroup}
                        onDismissCoachmark={onDismissShareCoachmark}
                    />
                ) : null}
            </div>
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
                            {virtualGrid.visibleRows.map((row) => (
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
                                    {row.items.map((item: FavoriteItem) => (
                                        <FavoriteCard
                                            key={item.key}
                                            item={item}
                                            instanceActionGate={instanceActionGatesByItemKey?.get(
                                                item.key
                                            )}
                                            selectionActive={
                                                selection.hasSelection
                                            }
                                            selected={selection.selectedKeysSet.has(
                                                item.key
                                            )}
                                            showGroupLabel={
                                                viewData.isSearchActive
                                            }
                                            densityConfig={densityConfig}
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
                                            onFriendLaunch={
                                                handleCardFriendLaunch
                                            }
                                            onFriendSelfInvite={
                                                handleCardFriendSelfInvite
                                            }
                                            onFriendInvite={
                                                handleCardFriendInvite
                                            }
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
                                            onAvatarSelect={
                                                handleCardAvatarSelect
                                            }
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <FavoritesSelectionBar
                    selectedCount={selection.selectedContentItems.length}
                    isAllSelected={selection.isAllSelected}
                    moveTargets={favoriteCommands.moveTargets}
                    copyTargets={favoriteCommands.copyTargets}
                    showCopyIdsButton={showCopyIdsButton}
                    actionsDisabled={selection.avatarSelectionActionsDisabled}
                    onSelectAll={selection.toggleSelectAll}
                    onClearSelection={handleClearSelection}
                    onCopyIds={handleCopyIds}
                    onCopySelection={handleCopySelection}
                    onMoveSelection={handleMoveSelection}
                    onBulkRemove={handleBulkRemoveSelection}
                />
            </div>
        </div>
    );
}
