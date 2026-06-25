import { useEffect, useState } from 'react';

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
    const selection = useFavoritesSelectionState({
        contentItems: viewData.contentItems,
        isSearchActive: viewData.isSearchActive,
        kind,
        selectedSource: filters.selectedSource
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
        refreshRemoteDetails: collections.actionInputs.refreshRemoteDetails,
        selectedContentItems: selection.selectedContentItems,
        selectedGroupKey: filters.selectedGroupKey,
        selectedSource: filters.selectedSource,
        setAvatarHistory: collections.actionInputs.setAvatarHistory,
        setAvatarHistoryLoading:
            collections.actionInputs.setAvatarHistoryLoading,
        setCreatingLocalGroup,
        setEditMode: selection.setEditMode,
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

    useEffect(() => {
        setExportDialogOpen(false);
        setCreatingLocalGroup(false);
        setNewLocalGroupName('');
    }, [kind]);

    return {
        actions,
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
