import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useFavoriteStore } from '@/state/favoriteStore';
import type { CurrentUserSnapshotState } from '@/state/runtimeStore';

import type {
    FavoriteGroup,
    FavoriteItem,
    FavoriteKind,
    FavoriteSource
} from './favoritesTypes';
import { useFavoritesBulkActions } from './useFavoritesBulkActions';
import { useFavoritesCollectionActions } from './useFavoritesCollectionActions';
import { useFavoritesItemActions } from './useFavoritesItemActions';

export function useFavoritesActions({
    allItems,
    avatarHistoryLoading,
    canInviteFromCurrentLocation,
    currentEndpoint,
    currentInviteLocation,
    currentUserId,
    currentUserSnapshot,
    friendsById,
    friendsMap,
    kind,
    localGroups,
    newLocalGroupName,
    refreshRemoteDetails,
    remoteGroups,
    selectedContentItems,
    selectedGroupKey,
    selectedSource,
    setAvatarHistory,
    setAvatarHistoryLoading,
    setCreatingLocalGroup,
    setExportDialogOpen,
    setNewLocalGroupName,
    setSelectedGroupKey,
    setSelectedKeys,
    setSelectedSource
}: {
    allItems: FavoriteItem[];
    avatarHistoryLoading: boolean;
    canInviteFromCurrentLocation: boolean;
    currentEndpoint: string;
    currentInviteLocation: string;
    currentUserId: string;
    currentUserSnapshot: CurrentUserSnapshotState | null;
    friendsById: Record<string, unknown>;
    friendsMap: Map<string, unknown>;
    kind: FavoriteKind;
    localGroups: FavoriteGroup[];
    newLocalGroupName: string;
    refreshRemoteDetails(): void;
    remoteGroups: FavoriteGroup[];
    selectedContentItems: FavoriteItem[];
    selectedGroupKey: string;
    selectedSource: FavoriteSource;
    setAvatarHistory(
        value: unknown[] | ((current: unknown[]) => unknown[])
    ): void;
    setAvatarHistoryLoading(value: boolean): void;
    setCreatingLocalGroup(value: boolean): void;
    setExportDialogOpen(value: boolean): void;
    setNewLocalGroupName(value: string): void;
    setSelectedGroupKey(value: string): void;
    setSelectedKeys(value: string[] | ((current: string[]) => string[])): void;
    setSelectedSource(value: FavoriteSource): void;
}) {
    const navigate = useNavigate();
    const [refreshing, setRefreshing] = useState(false);
    const [removingFavoriteKey, setRemovingFavoriteKey] = useState('');
    const removingFavoriteKeyRef = useRef('');
    const remoteFavoritesByObjectId = useFavoriteStore(
        (state) => state.remoteFavoritesByObjectId
    );
    const collectionActions = useFavoritesCollectionActions({
        allItems,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        kind,
        localGroups,
        refreshRemoteDetails,
        refreshing,
        removingFavoriteKeyRef,
        selectedGroupKey,
        selectedSource,
        setAvatarHistory,
        setExportDialogOpen,
        setRefreshing,
        setRemovingFavoriteKey,
        setSelectedGroupKey
    });
    const itemActions = useFavoritesItemActions({
        avatarHistoryLoading,
        canInviteFromCurrentLocation,
        currentInviteLocation,
        currentUserId,
        friendsById,
        friendsMap,
        kind,
        localGroups,
        newLocalGroupName,
        refreshing,
        selectedContentItems,
        selectedSource,
        setAvatarHistory,
        setAvatarHistoryLoading,
        setCreatingLocalGroup,
        setNewLocalGroupName,
        setSelectedGroupKey,
        setSelectedSource
    });
    const bulkActions = useFavoritesBulkActions({
        currentEndpoint,
        kind,
        localGroups,
        refreshFavorites: collectionActions.refreshFavorites,
        remoteFavoritesByObjectId,
        remoteGroups,
        selectedContentItems,
        selectedGroupKey,
        selectedSource,
        setSelectedKeys
    });

    function importFavorites() {
        navigate(`/favorites/import/${kind}`);
    }

    return {
        ...bulkActions,
        ...collectionActions,
        ...itemActions,
        importFavorites,
        refreshing,
        removingFavoriteKey
    };
}
