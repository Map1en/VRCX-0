import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils.js';

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import { FavoriteCard } from './FavoriteCard.jsx';
import { FavoriteExportDialog } from './FavoriteExportDialog.jsx';
import { FavoritesContentHeader } from './FavoritesContentHeader.jsx';
import { GroupRailSection } from './FavoritesGroupRail.jsx';
import { FavoritesEmptyState, FavoritesLoadingState } from './FavoritesStateParts.jsx';
import { FavoritesToolbar } from './FavoritesToolbar.jsx';

function FavoritesGroupRailPanel({ kind, groupRail }) {
    const { t } = useTranslation();

    const selectedSource = groupRail.hasSearchInput ? '' : groupRail.selectedSource;
    const selectedGroupKey = groupRail.hasSearchInput
        ? ''
        : groupRail.selectedGroupKey;

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-2">
            <GroupRailSection
                title={groupRail.remoteTitle}
                groups={groupRail.remoteGroups}
                selectedSource={selectedSource}
                selectedGroupKey={selectedGroupKey}
                loading={groupRail.remoteLoading}
                onRefresh={groupRail.onRefresh}
                onSelect={groupRail.onSelect}
                onRemoteRename={groupRail.onRemoteRename}
                onRemoteVisibility={groupRail.onRemoteVisibility}
                onRemoteClear={groupRail.onRemoteClear}
                onLocalRename={groupRail.onLocalRename}
                onLocalDelete={groupRail.onLocalDelete}
            />
            <GroupRailSection
                title={groupRail.localTitle}
                groups={groupRail.localGroups}
                selectedSource={selectedSource}
                selectedGroupKey={selectedGroupKey}
                loading={groupRail.localLoading}
                creating={groupRail.creatingLocalGroup}
                newGroupName={groupRail.newLocalGroupName}
                showNewGroup={groupRail.canCreateLocalGroup}
                onRefresh={groupRail.onRefresh}
                onSelect={groupRail.onSelect}
                onStartCreate={groupRail.onStartCreateLocalGroup}
                onNewGroupNameChange={groupRail.onNewGroupNameChange}
                onConfirmCreate={groupRail.onConfirmCreateLocalGroup}
                onCancelCreate={groupRail.onCancelCreateLocalGroup}
                onRemoteRename={groupRail.onRemoteRename}
                onRemoteVisibility={groupRail.onRemoteVisibility}
                onRemoteClear={groupRail.onRemoteClear}
                onLocalRename={groupRail.onLocalRename}
                onLocalDelete={groupRail.onLocalDelete}
            />
            {kind === 'avatar' ? (
                <GroupRailSection
                    title={t('view.favorite.avatars.local_history')}
                    groups={groupRail.avatarHistoryGroups}
                    selectedSource={selectedSource}
                    selectedGroupKey={selectedGroupKey}
                    loading={groupRail.avatarHistoryLoading}
                    onRefresh={groupRail.onAvatarHistoryRefresh}
                    onSelect={groupRail.onSelect}
                    onRemoteRename={groupRail.onRemoteRename}
                    onRemoteVisibility={groupRail.onRemoteVisibility}
                    onRemoteClear={groupRail.onRemoteClear}
                    onLocalRename={groupRail.onLocalRename}
                    onLocalDelete={groupRail.onLocalDelete}
                    onHistoryClear={groupRail.onAvatarHistoryClear}
                />
            ) : null}
        </div>
    );
}

function FavoritesContentPanel({ kind, content }) {
    const { t } = useTranslation();

    const remoteDetails = content.remoteEntityDetails || {};
    const remoteDetailsData = remoteDetails.data || {};
    const isRemoteDetailsLoading =
        kind !== 'friend' &&
        remoteDetails.status === 'running' &&
        !Object.keys(remoteDetailsData).length &&
        content.selectedSource === 'remote';

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col pl-[26px]">
            <FavoritesContentHeader
                title={content.title}
                subtitle={content.subtitle}
                editMode={content.editMode}
                editModeDisabled={content.editModeDisabled}
                editModeVisible={content.editModeVisible}
                isAllSelected={content.isAllSelected}
                hasSelection={content.hasSelection}
                showCopyButton={content.showCopyButton}
                onEditModeChange={content.onEditModeChange}
                onToggleSelectAll={content.onToggleSelectAll}
                onClearSelection={content.onClearSelection}
                onCopySelection={content.onCopySelection}
                onBulkRemove={content.onBulkRemove}
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-auto pr-2">
                {content.favoriteLoadStatus === 'running' &&
                !content.items.length ? (
                    <FavoritesLoadingState title={t('view.favorite.generated.loading_favorites_baseline')} />
                ) : content.favoriteLoadStatus === 'error' ? (
                    <FavoritesEmptyState
                        title={t('view.favorite.generated.favorites_failed_to_load')}
                        description={
                            content.favoriteDetail ||
                            'The favorites baseline did not finish loading.'
                        }
                    />
                ) : isRemoteDetailsLoading ? (
                    <FavoritesLoadingState
                        title={
                            kind === 'avatar'
                                ? 'Loading remote avatar details.'
                                : 'Loading remote world details.'
                        }
                    />
                ) : !content.items.length ? (
                    <FavoritesEmptyState
                        title={
                            content.isSearchActive
                                ? 'No matches found'
                                : 'No data'
                        }
                        description={
                            content.isSearchActive
                                ? 'Try a different search term.'
                                : 'The selected group currently has no items.'
                        }
                    />
                ) : (
                    <div
                        className="grid min-w-0"
                        style={{
                            gap: `${Math.max(4, Math.round(8 * content.cardSpacing))}px`,
                            gridTemplateColumns: `repeat(auto-fill,minmax(${Math.round(260 * content.cardScale)}px,1fr))`
                        }}
                    >
                        {content.items.map((item) => (
                            <FavoriteCard
                                key={item.key}
                                item={item}
                                editMode={
                                    content.editMode && !content.isSearchActive
                                }
                                selected={content.selectedKeysSet.has(item.key)}
                                showGroupLabel={content.isSearchActive}
                                cardScale={content.cardScale}
                                cardSpacing={content.cardSpacing}
                                removing={
                                    content.removingFavoriteKey === item.key
                                }
                                canSendInvite={content.canSendInvite}
                                canBoop={content.canBoop}
                                currentUserId={content.currentUserId}
                                currentAvatarId={content.currentAvatarId}
                                onToggleSelect={content.onToggleSelect}
                                onRemoveLocal={content.onRemoveLocal}
                                onRemoveRemote={content.onRemoveRemote}
                                onFriendLaunch={content.onFriendLaunch}
                                onFriendSelfInvite={content.onFriendSelfInvite}
                                onFriendInvite={content.onFriendInvite}
                                onFriendRequestInvite={
                                    content.onFriendRequestInvite
                                }
                                onFriendBoop={content.onFriendBoop}
                                onWorldNewInstance={
                                    content.onWorldNewInstance
                                }
                                onWorldSelfInvite={content.onWorldSelfInvite}
                                onAvatarSelect={content.onAvatarSelect}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export function FavoritesPageLayout({
    embedded,
    kind,
    pageConfig,
    toolbar,
    exportDialog,
    splitter,
    groupRail,
    content
}) {
    return (
        <div
            className={cn(
                'flex h-full min-h-0 flex-1 flex-col',
                embedded ? 'p-4 pb-0' : 'x-container pb-0'
            )}
        >
            <FavoritesToolbar
                kind={kind}
                sortValue={toolbar.sortValue}
                searchQuery={toolbar.searchQuery}
                searchPlaceholder={pageConfig.searchPlaceholder}
                searchMode={toolbar.searchMode}
                cardScale={toolbar.cardScale}
                cardSpacing={toolbar.cardSpacing}
                refreshing={toolbar.refreshing}
                onSortValueChange={toolbar.onSortValueChange}
                onSearchChange={toolbar.onSearchChange}
                onSearchModeChange={toolbar.onSearchModeChange}
                onCardScaleChange={toolbar.onCardScaleChange}
                onCardSpacingChange={toolbar.onCardSpacingChange}
                onRefresh={toolbar.onRefresh}
                onImport={toolbar.onImport}
                onExport={toolbar.onExport}
            />
            <FavoriteExportDialog
                open={exportDialog.open}
                onOpenChange={exportDialog.onOpenChange}
                kind={kind}
                remoteGroups={groupRail.remoteGroups}
                localGroups={groupRail.localGroups}
                remoteItemsByGroup={exportDialog.remoteItemsByGroup}
                localItemsByGroup={exportDialog.localItemsByGroup}
            />

            <div className="flex h-full min-h-0 min-w-0 flex-1">
                <ResizablePanelGroup
                    key={`${kind}:${splitter.layoutVersion}`}
                    id={`favorites-${kind}-splitter`}
                    orientation="horizontal"
                    className="h-full min-h-0 min-w-0 flex-1"
                    onLayoutChanged={splitter.onLayoutChanged}
                >
                    <ResizablePanel
                        id={`favorites-${kind}-groups`}
                        defaultSize={splitter.sizePx}
                        minSize={splitter.minSizePx}
                        className="min-w-0"
                        collapsible
                        collapsedSize={0}
                        groupResizeBehavior="preserve-pixel-size"
                        onResize={splitter.onResize}
                    >
                        <FavoritesGroupRailPanel
                            kind={kind}
                            groupRail={groupRail}
                        />
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                        id={`favorites-${kind}-content`}
                        minSize={splitter.contentMinSizePx}
                        className="min-w-0"
                    >
                        <FavoritesContentPanel kind={kind} content={content} />
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </div>
    );
}
