import { useEffect, useMemo, useRef, useState } from 'react';

import {
    buildLocalInstanceActionGateMap,
    evaluateLocalInstanceActionGates,
    type LocalInstanceActionGateTarget
} from '@/shared/utils/invite';
import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

import { resolveFavoritePresenceLocation } from './favoritesPageData';
import type { FavoriteKind } from './favoritesTypes';
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

const FAVORITES_REVISION_DEBOUNCE_MS = 400;

type FavoriteSeedRecord = Record<string, unknown> & {
    state?: unknown;
    stateBucket?: unknown;
    status?: unknown;
};

function textValue(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isFavoriteSeedRecord(value: unknown): value is FavoriteSeedRecord {
    return Boolean(value && typeof value === 'object');
}

export function buildFavoriteGateTarget(item: {
    id: string;
    key: string;
    kind: FavoriteKind;
    seedData?: unknown;
}): LocalInstanceActionGateTarget | null {
    if (item.kind !== 'friend') {
        return null;
    }
    const location = resolveFavoritePresenceLocation(item.seedData);
    if (!location) {
        return null;
    }
    const seed = isFavoriteSeedRecord(item.seedData) ? item.seedData : {};
    const stateBucket =
        textValue(seed.status).toLowerCase() === 'active'
            ? 'online'
            : textValue(seed.stateBucket || seed.state);
    return {
        key: item.key,
        userId: item.id,
        location,
        stateBucket,
        isCurrentUser: false
    };
}

export function useFavoritesPageController({ kind }: { kind: FavoriteKind }) {
    const filters = useFavoritesFilters({ kind });
    const runtime = useFavoritesRuntime();
    const collections = useFavoritesCollectionsState({
        currentEndpoint: runtime.currentEndpoint,
        currentUserId: runtime.currentUserId,
        kind
    });
    const layout = useFavoritesLayoutPreferences(kind);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [creatingLocalGroup, setCreatingLocalGroup] = useState(false);
    const [newLocalGroupName, setNewLocalGroupName] = useState('');
    const viewData = useFavoritesViewData({
        ...collections.viewDataInputs,
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
        remoteGroups: viewData.remoteGroups,
        refreshRemoteDetails: collections.actionInputs.refreshRemoteDetails,
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
        avatarHistoryGroups: viewData.avatarHistoryGroups,
        localGroups: viewData.localGroups,
        remoteGroups: viewData.remoteGroups,
        selectedGroupKey: filters.selectedGroupKey,
        selectedSource: filters.selectedSource,
        setSelectedGroupKey: filters.setSelectedGroupKey,
        setSelectedSource: filters.setSelectedSource
    });

    const favoriteRevision = useFavoriteRevisionStore(
        (state) => state.revision
    );
    const refreshFavoritesRef = useRef(actions.refreshFavorites);
    refreshFavoritesRef.current = actions.refreshFavorites;
    useEffect(() => {
        const timer = setTimeout(() => {
            const pending = useFavoriteRevisionStore
                .getState()
                .consumePending();
            if (pending.remote || pending.unknown) {
                void refreshFavoritesRef.current({ silent: true });
            }
        }, FAVORITES_REVISION_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [favoriteRevision]);

    useEffect(() => {
        setExportDialogOpen(false);
        setCreatingLocalGroup(false);
        setNewLocalGroupName('');
    }, [kind]);

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
        runtime,
        selection,
        setCreatingLocalGroup,
        setExportDialogOpen,
        setNewLocalGroupName,
        viewData
    };
}
