import {
    closestCenter,
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent
} from '@dnd-kit/core';
import {
    rectSortingStrategy,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TFunction } from 'i18next';
import {
    CloudIcon,
    HardDriveIcon,
    HistoryIcon,
    SearchXIcon,
    Share2Icon,
    StarIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { isTextEntryTarget } from '@/components/keyboard/keyboardShortcutGuards';
import type { FavoriteKind } from '@/domain/favorites/types';
import { cn } from '@/lib/utils';
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
import type { FavoriteGroupView, FavoriteItem } from '../favoritesTypes';
import type { useFavoritesPageController } from '../useFavoritesPageController';
import { useFavoritesVirtualGrid } from '../useFavoritesVirtualGrid';
import { useStableEvent } from '../useStableEvent';
import { FavoriteCard } from './FavoriteCard';
import { GroupRailSection } from './FavoritesGroupRail';
import { FavoritesSelectionBar } from './FavoritesSelectionBar';
import {
    FavoritesEmptyState,
    FavoritesSkeletonGrid
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
    onShareCollectionGroup?(group: FavoriteGroupView): void;
    setCreatingLocalGroup: FavoritesController['setCreatingLocalGroup'];
    viewData: FavoritesController['viewData'];
};

type FavoritesContentPanelProps = {
    collections: FavoritesController['collections'];
    favoriteCommands: FavoritesController['actions'];
    filters: FavoritesController['filters'];
    kind: FavoriteKind;
    layout: FavoritesController['layout'];
    order: FavoritesController['order'];
    selection: FavoritesController['selection'];
    viewData: FavoritesController['viewData'];
    onShareCollectionGroup?(group: FavoriteGroupView): void;
    shareCoachmarkOpen?: boolean;
    onDismissShareCoachmark?(): void;
    instanceActionGatesByItemKey: FavoritesController['instanceActionGatesByItemKey'];
    onVisibleWorldIdsChange: FavoritesController['setVisibleWorldIds'];
};

function SortableFavoriteCell({
    itemKey,
    padding,
    children
}: {
    itemKey: string;
    padding: number;
    children: ReactNode;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: itemKey });
    return (
        <div
            ref={setNodeRef}
            className={cn(
                'min-h-0 min-w-0 [&_.cursor-pointer]:cursor-grab',
                isDragging && 'opacity-40'
            )}
            style={{
                padding: `${padding}px`,
                transform: CSS.Translate.toString(transform),
                transition
            }}
            {...attributes}
            {...listeners}
        >
            {children}
        </div>
    );
}

type ShareCollectionButtonProps = {
    group: FavoriteGroupView;
    coachmarkOpen: boolean;
    onShare(group: FavoriteGroupView): void;
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

    const selectGroup = useStableEvent((group: FavoriteGroupView) => {
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
                emptyTitle={t('empty_state.favorite_remote_groups_title')}
                emptyDescription={t(
                    'empty_state.favorite_remote_groups_description'
                )}
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
                emptyTitle={t('empty_state.favorite_local_groups_title')}
                emptyDescription={t(
                    'empty_state.favorite_local_groups_description'
                )}
                groups={viewData.localGroups}
                selectedSource={activeSource}
                selectedGroupKey={activeGroupKey}
                loading={favoriteCommands.refreshing}
                creating={creatingLocalGroup}
                newGroupName={newLocalGroupName}
                newGroupLabel={viewData.pageConfig.localNewGroupLabel}
                showNewGroup={viewData.canCreateLocalGroup}
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
                onReorder={favoriteCommands.handleLocalGroupReorder}
            />
            {kind === 'avatar' ? (
                <GroupRailSection
                    title={t('view.favorite.avatars.local_history')}
                    icon={HistoryIcon}
                    emptyTitle={t('empty_state.avatar_history_title')}
                    emptyDescription={t(
                        'empty_state.avatar_history_description'
                    )}
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
    order,
    selection,
    viewData,
    onShareCollectionGroup,
    shareCoachmarkOpen,
    onDismissShareCoachmark,
    instanceActionGatesByItemKey,
    onVisibleWorldIdsChange
}: FavoritesContentPanelProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
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
    const visibleWorldIdsKey =
        kind === 'world'
            ? virtualGrid.visibleRows
                  .flatMap((row) => row.items)
                  .filter((item) => item.source === 'local')
                  .map((item) => item.id)
                  .join('|')
            : '';
    useEffect(() => {
        onVisibleWorldIdsChange(
            visibleWorldIdsKey ? visibleWorldIdsKey.split('|') : []
        );
    }, [onVisibleWorldIdsChange, visibleWorldIdsKey]);
    const favoritesSkeletonGrid = (
        <FavoritesSkeletonGrid
            cardHeight={virtualGrid.cardHeight}
            columnCount={virtualGrid.gridColumnCount}
            densityConfig={densityConfig}
            gridGap={virtualGrid.gridGap}
            gridMinWidth={virtualGrid.gridMinWidth}
            gridPadding={virtualGrid.gridPadding}
            viewportHeight={virtualGrid.viewportHeight}
        />
    );
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
    let emptyTitle = t(`empty_state.favorite_${kind}s_title`);
    let emptyDescription = t(`empty_state.favorite_${kind}s_description`);
    if (viewData.isSearchActive) {
        emptyTitle = t('common.no_matching_records');
        emptyDescription = t('view.favorite.label.try_a_different_search_term');
    } else if (!viewData.selectedGroup) {
        emptyTitle = t('view.favorites.empty.no_group_selected');
        emptyDescription = t('empty_state.favorite_choose_group_description');
    }
    const searchTab = kind === 'friend' ? 'user' : kind;

    const dragClickSuppressedRef = useRef(false);
    const [activeDragKey, setActiveDragKey] = useState('');
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 6
            }
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );
    const contentItemKeys = useMemo(
        () => viewData.contentItems.map((item) => item.key),
        [viewData.contentItems]
    );
    const activeDragItem = activeDragKey
        ? viewData.contentItems.find((item) => item.key === activeDragKey)
        : undefined;
    function releaseDragClickSuppression() {
        setActiveDragKey('');
        window.setTimeout(() => {
            dragClickSuppressedRef.current = false;
        }, 0);
    }
    function handleDragStart({ active }: DragStartEvent) {
        dragClickSuppressedRef.current = true;
        setActiveDragKey(String(active.id));
    }
    function handleDragEnd({ active, over }: DragEndEvent) {
        if (over && active.id !== over.id) {
            order.moveItem(String(active.id), String(over.id));
        }
        releaseDragClickSuppression();
    }

    const handleToggleSelect = useStableEvent(
        (itemKey: string, checked: boolean, shift: boolean) => {
            if (dragClickSuppressedRef.current) {
                return;
            }
            selection.selectItem(itemKey, checked, { shift });
        }
    );
    const handleMoveSelectionToTop = useStableEvent(() =>
        order.moveSelectionToEdge('top')
    );
    const handleMoveSelectionToBottom = useStableEvent(() =>
        order.moveSelectionToEdge('bottom')
    );
    const handleClearSelection = useStableEvent(() =>
        selection.clearSelection()
    );
    const handleEscapeKeyDown = useStableEvent((event: KeyboardEvent) => {
        if (event.key !== 'Escape' || isTextEntryTarget(event.target)) {
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

    const favoritesGrid = (
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
                        height: `${row.cellHeight}px`,
                        gridTemplateColumns: `repeat(${virtualGrid.gridColumnCount}, minmax(${virtualGrid.gridMinWidth}px, 1fr))`,
                        transform: `translateY(${row.top}px)`
                    }}
                >
                    {row.items.map((item: FavoriteItem) => {
                        const card = (
                            <FavoriteCard
                                item={item}
                                instanceActionGate={instanceActionGatesByItemKey?.get(
                                    item.key
                                )}
                                selectionActive={
                                    selection.hasSelection || order.editing
                                }
                                selected={selection.selectedKeysSet.has(
                                    item.key
                                )}
                                showGroupLabel={viewData.isSearchActive}
                                densityConfig={densityConfig}
                                removing={
                                    favoriteCommands.removingFavoriteKey ===
                                    item.key
                                }
                                onToggleSelect={handleToggleSelect}
                                onRemoveLocal={handleCardRemoveLocalFavorite}
                                onRemoveRemote={handleCardRemoveRemoteFavorite}
                                onFriendLaunch={handleCardFriendLaunch}
                                onFriendSelfInvite={handleCardFriendSelfInvite}
                                onFriendInvite={handleCardFriendInvite}
                                onFriendRequestInvite={
                                    handleCardFriendRequestInvite
                                }
                                onFriendBoop={handleCardFriendBoop}
                                onWorldNewInstance={handleCardWorldNewInstance}
                                onWorldSelfInvite={handleCardWorldSelfInvite}
                                onAvatarSelect={handleCardAvatarSelect}
                            />
                        );
                        return order.editing ? (
                            <SortableFavoriteCell
                                key={item.key}
                                itemKey={item.key}
                                padding={virtualGrid.gridPadding}
                            >
                                {card}
                            </SortableFavoriteCell>
                        ) : (
                            <div
                                key={item.key}
                                className="min-h-0 min-w-0"
                                style={{
                                    padding: `${virtualGrid.gridPadding}px`
                                }}
                            >
                                {card}
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );

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
                        favoritesSkeletonGrid
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
                    ) : !viewData.contentItems.length ? (
                        <FavoritesEmptyState
                            icon={
                                viewData.isSearchActive ? SearchXIcon : StarIcon
                            }
                            title={emptyTitle}
                            description={emptyDescription}
                        >
                            {viewData.isSearchActive ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    onClick={() => filters.setSearchQuery('')}
                                >
                                    {t('empty_state.clear_search')}
                                </Button>
                            ) : viewData.selectedGroup ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    onClick={() =>
                                        navigate(`/search?tab=${searchTab}`)
                                    }
                                >
                                    {t(`empty_state.find_more_${kind}s`)}
                                </Button>
                            ) : null}
                        </FavoritesEmptyState>
                    ) : order.editing ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onDragCancel={releaseDragClickSuppression}
                        >
                            <SortableContext
                                items={contentItemKeys}
                                strategy={rectSortingStrategy}
                            >
                                {favoritesGrid}
                            </SortableContext>
                            <DragOverlay className="cursor-grabbing [&_*]:cursor-grabbing">
                                {activeDragItem ? (
                                    <FavoriteCard
                                        item={activeDragItem}
                                        selectionActive
                                        selected={selection.selectedKeysSet.has(
                                            activeDragItem.key
                                        )}
                                        densityConfig={densityConfig}
                                    />
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    ) : (
                        favoritesGrid
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
                    onMoveToTop={
                        order.canMoveSelection
                            ? handleMoveSelectionToTop
                            : undefined
                    }
                    onMoveToBottom={
                        order.canMoveSelection
                            ? handleMoveSelectionToBottom
                            : undefined
                    }
                />
            </div>
        </div>
    );
}
