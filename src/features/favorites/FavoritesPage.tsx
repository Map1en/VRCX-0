import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PageScaffold } from '@/components/layout/PageScaffold';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';

import { FavoriteExportDialog } from './components/FavoriteExportDialog';
import { FavoriteShareCollectionDialog } from './components/FavoriteShareCollectionDialog';
import {
    FavoritesContentPanel,
    FavoritesGroupRailPanel
} from './components/FavoritesPanels';
import { FavoritesToolbar } from './components/FavoritesToolbar';
import type {
    FavoriteGroup,
    FavoriteItem,
    FavoriteKind
} from './favoritesTypes';
import {
    buildShareCollectionWorldIds,
    SHARE_COLLECTION_CLIENT_WORLD_CAP
} from './shareCollectionDialogModel';
import { useFavoritesPageController } from './useFavoritesPageController';

function useStableEvent(handler: any) {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    return useCallback((...args: any[]) => handlerRef.current?.(...args), []);
}

function FavoritesPage({
    kind,
    embedded = false
}: {
    kind: FavoriteKind;
    embedded?: boolean;
}) {
    const { t } = useTranslation();
    const state = useFavoritesPageController({ kind });
    const [shareCollectionGroup, setShareCollectionGroup] =
        useState<FavoriteGroup | null>(null);
    const {
        actions,
        collections,
        creatingLocalGroup,
        exportDialogOpen,
        filters,
        layout,
        newLocalGroupName,
        selection,
        setCreatingLocalGroup,
        setExportDialogOpen,
        setNewLocalGroupName,
        viewData,
        instanceActionGatesByItemKey
    } = state;
    const handleGroupRailRefresh = useStableEvent(() =>
        actions.refreshFavorites()
    );
    const handleImportFavorites = useStableEvent(() =>
        actions.importFavorites()
    );
    const handleExportFavorites = useStableEvent(() =>
        actions.exportCurrentFavorites()
    );
    const handleSplitterResize = useStableEvent(layout.handleSplitterResize);
    const handleSplitterLayout = useStableEvent(layout.persistSplitterLayout);
    const shareCollectionItems = useMemo<FavoriteItem[]>(() => {
        if (kind !== 'world' || !shareCollectionGroup) {
            return [];
        }
        const itemsByGroup =
            shareCollectionGroup.source === 'remote'
                ? viewData.remoteItemsByGroup
                : viewData.localItemsByGroup;
        return itemsByGroup[shareCollectionGroup.key] || [];
    }, [
        kind,
        shareCollectionGroup,
        viewData.localItemsByGroup,
        viewData.remoteItemsByGroup
    ]);
    const handleShareCollectionGroup = useStableEvent(
        (group: FavoriteGroup) => {
            const itemsByGroup =
                group.source === 'remote'
                    ? viewData.remoteItemsByGroup
                    : viewData.localItemsByGroup;
            const groupItems = itemsByGroup[group.key] || [];
            const { totalWorldIds } = buildShareCollectionWorldIds(groupItems);
            if (totalWorldIds > SHARE_COLLECTION_CLIENT_WORLD_CAP) {
                toast.error(
                    t('view.favorite.share_collection.toast.too_many', {
                        cap: SHARE_COLLECTION_CLIENT_WORLD_CAP
                    })
                );
                return;
            }
            setShareCollectionGroup(group);
        }
    );

    return (
        <PageScaffold
            embedded={embedded}
            flushBottom
            embeddedClassName="p-4"
            className="flex-1"
        >
            <FavoritesToolbar
                kind={kind}
                sortValue={layout.sortValue}
                searchQuery={filters.searchQuery}
                searchPlaceholder={viewData.pageConfig.searchPlaceholder}
                searchMode={filters.searchMode}
                density={layout.density}
                refreshing={
                    actions.refreshing ||
                    collections.favoriteLoadStatus === 'running'
                }
                onSortValueChange={layout.handleSortValueChange}
                onSearchChange={filters.setSearchQuery}
                onSearchModeChange={filters.setSearchMode}
                onDensityChange={layout.handleDensityChange}
                onRefresh={handleGroupRailRefresh}
                onImport={handleImportFavorites}
                onExport={handleExportFavorites}
            />
            <FavoriteExportDialog
                open={exportDialogOpen}
                onOpenChange={setExportDialogOpen}
                kind={kind}
                remoteGroups={viewData.remoteGroups}
                localGroups={viewData.localGroups}
                remoteItemsByGroup={viewData.remoteItemsByGroup}
                localItemsByGroup={viewData.localItemsByGroup}
            />
            <FavoriteShareCollectionDialog
                open={kind === 'world' && Boolean(shareCollectionGroup)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setShareCollectionGroup(null);
                    }
                }}
                group={shareCollectionGroup}
                items={shareCollectionItems}
            />

            <div className="flex h-full min-h-0 min-w-0 flex-1">
                <ResizablePanelGroup
                    key={`${kind}:${layout.splitterLayoutVersion}`}
                    id={`favorites-${kind}-splitter`}
                    orientation="horizontal"
                    className="h-full min-h-0 min-w-0 flex-1"
                    onLayoutChanged={handleSplitterLayout}
                >
                    <ResizablePanel
                        id={`favorites-${kind}-groups`}
                        defaultSize={layout.splitterSizePx}
                        minSize={0}
                        className="min-w-0"
                        collapsible
                        collapsedSize={0}
                        groupResizeBehavior="preserve-pixel-size"
                        onResize={handleSplitterResize}
                    >
                        <FavoritesGroupRailPanel
                            kind={kind}
                            favoriteCommands={actions}
                            collections={collections}
                            creatingLocalGroup={creatingLocalGroup}
                            filters={filters}
                            newLocalGroupName={newLocalGroupName}
                            onNewGroupNameChange={setNewLocalGroupName}
                            onShareCollectionGroup={
                                kind === 'world'
                                    ? handleShareCollectionGroup
                                    : undefined
                            }
                            setCreatingLocalGroup={setCreatingLocalGroup}
                            viewData={viewData}
                        />
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                        id={`favorites-${kind}-content`}
                        minSize={320}
                        className="min-w-0"
                    >
                        <FavoritesContentPanel
                            kind={kind}
                            favoriteCommands={actions}
                            collections={collections}
                            filters={filters}
                            layout={layout}
                            selection={selection}
                            viewData={viewData}
                            instanceActionGatesByItemKey={
                                instanceActionGatesByItemKey
                            }
                        />
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </PageScaffold>
    );
}

export function FavoriteFriendsPage(props: any) {
    return <FavoritesPage kind="friend" {...props} />;
}

export function FavoriteWorldsPage(props: any) {
    return <FavoritesPage kind="world" {...props} />;
}

export function FavoriteAvatarsPage(props: any) {
    return <FavoritesPage kind="avatar" {...props} />;
}
