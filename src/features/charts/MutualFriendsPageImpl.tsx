import { PageScaffold } from '@/components/layout/PageScaffold';

import { MutualFriendsHud } from './components/mutual-friends/MutualFriendsHud';
import { MutualFriendsLegend } from './components/mutual-friends/MutualFriendsLegend';
import { MutualFriendsNodeCard } from './components/mutual-friends/MutualFriendsNodeCard';
import { MutualFriendsSettingsSheet } from './components/mutual-friends/MutualFriendsSettingsSheet';
import {
    MutualFriendsLayoutBadge,
    MutualFriendsStageOverlay
} from './components/mutual-friends/MutualFriendsStageOverlay';
import { useMutualFriendsPageState } from './mutual-friends/useMutualFriendsPageState';

export function MutualFriendsPage() {
    const { actions, exclusions, fetch, graph, layout, selection, view } =
        useMutualFriendsPageState();

    const hasActiveFilters = Boolean(
        view.filters.searchQuery ||
        view.filters.minDegree > 0 ||
        view.filters.focusedCommunity !== null
    );
    const selectedNode = selection.node;
    const selectedCommunity =
        selection.communityIndex === null
            ? null
            : (graph.communities.find(
                  (community) => community.index === selection.communityIndex
              ) ?? null);

    return (
        <PageScaffold id="chart" className="p-0">
            <div className="relative min-h-0 flex-1 overflow-hidden">
                <div
                    ref={graph.setGraphElementRef}
                    className="absolute inset-0"
                />

                <MutualFriendsHud
                    baseNodeCount={graph.baseNodeCount}
                    canFetch={Boolean(graph.currentUserId)}
                    fetchProgress={fetch.fetchProgress}
                    isReloading={
                        graph.status === 'running' && graph.baseNodeCount > 0
                    }
                    onCancelFetch={actions.cancelFetch}
                    onFetchGraph={actions.fetchGraph}
                    onRefreshPage={actions.refreshPage}
                    onSearchQueryChange={actions.setSearchQuery}
                    searchQuery={view.filters.searchQuery}
                    settingsSlot={
                        <MutualFriendsSettingsSheet
                            edgeCount={graph.edgeCount}
                            excludeSearchQuery={exclusions.excludeSearchQuery}
                            excludedCount={exclusions.excludedCount}
                            excludedFriendIdSet={exclusions.excludedFriendIdSet}
                            filteredExcludeOptions={
                                exclusions.filteredExcludeOptions
                            }
                            layoutSettings={layout.layoutSettings}
                            nodeCount={graph.nodeCount}
                            onExcludeSearchQueryChange={
                                exclusions.setExcludeSearchQuery
                            }
                            onResetLayoutAndHidden={
                                actions.resetLayoutAndHidden
                            }
                            onToggleExcludedFriendId={
                                actions.toggleExcludedFriendId
                            }
                            setLayoutSetting={layout.setLayoutSetting}
                        />
                    }
                />

                {graph.isLayoutRunning && graph.nodeCount ? (
                    <MutualFriendsLayoutBadge />
                ) : null}

                {graph.baseNodeCount > 0 && graph.nodeCount > 0 ? (
                    <MutualFriendsLegend
                        communities={graph.communities}
                        coverage={graph.coverage}
                        focusedCommunity={view.filters.focusedCommunity}
                        isolatedCounts={graph.isolatedCounts}
                        minDegree={view.filters.minDegree}
                        onMinDegreeChange={actions.setMinDegree}
                        onToggleFocusedCommunity={
                            actions.toggleFocusedCommunity
                        }
                    />
                ) : null}

                {selectedNode ? (
                    <MutualFriendsNodeCard
                        community={selectedCommunity}
                        isRefreshing={selection.isRefreshing}
                        node={selectedNode}
                        onClose={actions.clearSelection}
                        onFocusCommunity={() => {
                            if (selection.communityIndex !== null) {
                                actions.toggleFocusedCommunity(
                                    selection.communityIndex
                                );
                            }
                        }}
                        onHide={() =>
                            actions.toggleExcludedFriendId(selectedNode.id)
                        }
                        onOpenProfile={() => actions.openNode(selectedNode.id)}
                        onRefresh={actions.refreshSelectedNode}
                        user={selection.user}
                    />
                ) : null}

                <MutualFriendsStageOverlay
                    baseNodeCount={graph.baseNodeCount}
                    detail={graph.detail}
                    hasActiveFilters={hasActiveFilters}
                    nodeCount={graph.nodeCount}
                    onLoadConnections={actions.fetchGraph}
                    onClearFilters={actions.clearFilters}
                    status={graph.status}
                />
            </div>
        </PageScaffold>
    );
}
