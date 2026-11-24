import { arrayMove } from '@dnd-kit/sortable';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { FavoriteKind } from '@/domain/favorites/types';
import { presenceOf, presenceLiveInstanceTag } from '@/domain/friends/presence';
import { reconcilePendingFavoriteRevision } from '@/services/favoriteRevisionReconciliationService';
import {
    buildLocalInstanceActionGateMap,
    evaluateLocalInstanceActionGates,
    type LocalInstanceActionGateTarget
} from '@/shared/utils/invite';
import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

import { normalizeFavoriteSearchValue } from './favoritesItems';
import type { FavoriteSeedData } from './favoritesTypes';
import { useFavoritesActions } from './useFavoritesActions';
import { useFavoritesCollectionsState } from './useFavoritesCollectionsState';
import {
    useFavoritesFilters,
    useFavoritesSelectedGroupSync
} from './useFavoritesFilters';
import { useFavoritesLayoutPreferences } from './useFavoritesLayoutPreferences';
import { useFavoritesRuntime } from './useFavoritesRuntime';
import { useFavoritesSelectionState } from './useFavoritesSelectionState';
import { useFavoritesViewData } from './useFavoritesViewData';
import {
    moveFavoritesToEdge,
    useLocalFavoriteCustomOrder
} from './useLocalFavoriteCustomOrder';

const FAVORITES_REVISION_DEBOUNCE_MS = 400;

export function buildFavoriteGateTarget(item: {
    id: string;
    key: string;
    kind: FavoriteKind;
    seedData?: FavoriteSeedData | null;
}): LocalInstanceActionGateTarget | null {
    const presence = presenceOf(item.seedData);
    if (item.kind !== 'friend' || !presence) {
        return null;
    }
    if (!presenceLiveInstanceTag(presence, { preferTraveling: true })) {
        return null;
    }
    return {
        key: item.key,
        userId: item.id,
        location: presenceLiveInstanceTag(presence, { preferTraveling: false }),
        presenceKind: presence.kind,
        isCurrentUser: false
    };
}

export function useFavoritesPageController({ kind }: { kind: FavoriteKind }) {
    const filters = useFavoritesFilters({ kind });
    const runtime = useFavoritesRuntime();
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const loadAllRemoteDetails =
        exportDialogOpen ||
        normalizeFavoriteSearchValue(filters.searchQuery).length >= 3;
    const [visibleWorldIds, setVisibleWorldIds] = useState<string[]>([]);
    const collections = useFavoritesCollectionsState({
        currentEndpoint: runtime.currentEndpoint,
        currentUserId: runtime.currentUserId,
        kind,
        loadAllRemoteDetails,
        selectedGroupKey: filters.selectedGroupKey,
        selectedSource: filters.selectedSource,
        visibleWorldIds
    });
    const layout = useFavoritesLayoutPreferences(kind);
    const [creatingLocalGroup, setCreatingLocalGroup] = useState(false);
    const [newLocalGroupName, setNewLocalGroupName] = useState('');
    const [orderEditing, setOrderEditing] = useState(false);
    const customOrder = useLocalFavoriteCustomOrder({
        currentUserId: runtime.currentUserId,
        enabled: layout.sortValue === 'custom',
        kind
    });
    const viewData = useFavoritesViewData({
        ...collections.viewDataInputs,
        customOrderByGroup: customOrder.customOrderByGroup,
        kind,
        searchMode: filters.searchMode,
        searchQuery: filters.searchQuery,
        selectedGroupKey: filters.selectedGroupKey,
        selectedSource: filters.selectedSource,
        sortValue: layout.sortValue
    });
    const instanceActionGateTargets = useMemo(
        () =>
            viewData.contentItems
                .map(buildFavoriteGateTarget)
                .filter(
                    (target): target is LocalInstanceActionGateTarget =>
                        target != null
                ),
        [viewData.contentItems]
    );
    const instanceActionGatesByItemKey = useMemo(
        () =>
            buildLocalInstanceActionGateMap(
                evaluateLocalInstanceActionGates({
                    currentUserId: runtime.currentUserId,
                    currentInviteLocation: runtime.currentInviteLocation,
                    isGameRunning: Boolean(runtime.gameState?.isGameRunning),
                    friendUserIds: Object.keys(
                        collections.actionInputs.friendsById || {}
                    ),
                    targets: instanceActionGateTargets
                }).targets
            ),
        [
            collections.actionInputs.friendsById,
            runtime.currentInviteLocation,
            runtime.currentUserId,
            runtime.gameState?.isGameRunning,
            instanceActionGateTargets
        ]
    );
    const selection = useFavoritesSelectionState({
        contentItems: viewData.contentItems,
        kind
    });
    const actions = useFavoritesActions({
        allItems: viewData.allItems,
        avatarHistoryLoading: collections.actionInputs.avatarHistoryLoading,
        canInviteFromCurrentLocation: runtime.canInviteFromCurrentLocation,
        currentEndpoint: runtime.currentEndpoint,
        currentInviteLocation: runtime.currentInviteLocation,
        currentUserId: runtime.currentUserId,
        currentUserSnapshot: runtime.currentUserSnapshot,
        friendsById: collections.actionInputs.friendsById,
        friendsMap: collections.actionInputs.friendsMap,
        kind,
        localGroups: viewData.localGroups,
        newLocalGroupName,
        reloadLocalWorldFavorites:
            collections.actionInputs.reloadLocalWorldFavorites,
        remoteGroups: viewData.remoteGroups,
        selectedContentItems: selection.selectedContentItems,
        selectedGroupKey: filters.selectedGroupKey,
        selectedSource: filters.selectedSource,
        setAvatarHistory: collections.actionInputs.setAvatarHistory,
        setAvatarHistoryLoading:
            collections.actionInputs.setAvatarHistoryLoading,
        setCreatingLocalGroup,
        setExportDialogOpen,
        setNewLocalGroupName,
        setSelectedGroupKey: filters.setSelectedGroupKey,
        setSelectedKeys: selection.setSelectedKeys,
        setSelectedSource: filters.setSelectedSource
    });

    useFavoritesSelectedGroupSync({
        autoSelectGroup: filters.autoSelectGroup,
        avatarHistoryGroups: viewData.avatarHistoryGroups,
        localGroups: viewData.localGroups,
        remoteGroups: viewData.remoteGroups,
        restoreGroup: filters.restoreGroup,
        restoreTarget: filters.restoreTarget,
        selectedGroupKey: filters.selectedGroupKey,
        selectedSource: filters.selectedSource
    });

    const favoriteRevision = useFavoriteRevisionStore(
        (state) => state.revision
    );
    const refreshFavoritesRef = useRef(actions.refreshFavorites);
    useLayoutEffect(() => {
        refreshFavoritesRef.current = actions.refreshFavorites;
    });
    useEffect(() => {
        if (actions.refreshing) {
            return;
        }
        const timer = setTimeout(() => {
            void reconcilePendingFavoriteRevision(refreshFavoritesRef.current);
        }, FAVORITES_REVISION_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [actions.refreshing, favoriteRevision]);

    useEffect(() => {
        setExportDialogOpen(false);
        setCreatingLocalGroup(false);
        setNewLocalGroupName('');
        setOrderEditing(false);
    }, [kind]);

    const canEditOrder =
        filters.selectedSource === 'local' &&
        Boolean(viewData.selectedGroup) &&
        !viewData.hasSearchInput;
    const canSaveOrder = canEditOrder && layout.sortValue === 'custom';
    const orderEditingActive = orderEditing && canSaveOrder;
    useEffect(() => {
        if (orderEditing && !orderEditingActive) {
            setOrderEditing(false);
        }
    }, [orderEditing, orderEditingActive]);

    function saveContentOrder(entityIds: string[]) {
        const groupKey = viewData.selectedGroup?.key;
        if (canSaveOrder && groupKey) {
            void customOrder.reorderGroup(groupKey, entityIds);
        }
    }

    const order = {
        canEdit: canEditOrder,
        canMoveSelection: canSaveOrder,
        editing: orderEditingActive,
        start() {
            if (!canEditOrder) {
                return;
            }
            if (layout.sortValue !== 'custom') {
                layout.handleSortValueChange('custom');
            }
            selection.clearSelection();
            setOrderEditing(true);
        },
        stop() {
            selection.clearSelection();
            setOrderEditing(false);
        },
        moveItem(activeKey: string, overKey: string) {
            const keys = viewData.contentItems.map((item) => item.key);
            const fromIndex = keys.indexOf(activeKey);
            const toIndex = keys.indexOf(overKey);
            if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
                return;
            }
            saveContentOrder(
                arrayMove(viewData.contentItems, fromIndex, toIndex).map(
                    (item) => item.id
                )
            );
        },
        moveSelectionToEdge(edge: 'top' | 'bottom') {
            saveContentOrder(
                moveFavoritesToEdge(
                    viewData.contentItems.map((item) => item.id),
                    new Set(
                        selection.selectedContentItems.map((item) => item.id)
                    ),
                    edge
                )
            );
        }
    };

    return {
        actions,
        instanceActionGatesByItemKey,
        collections,
        creatingLocalGroup,
        exportDialogOpen,
        filters,
        kind,
        layout,
        newLocalGroupName,
        order,
        runtime,
        selection,
        setCreatingLocalGroup,
        setExportDialogOpen,
        setNewLocalGroupName,
        setVisibleWorldIds,
        viewData
    };
}
