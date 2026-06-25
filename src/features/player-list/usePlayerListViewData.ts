import { useMemo } from 'react';

import { parseLocation } from '@/shared/utils/location';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { enrichPlayerListRows } from './playerListEnrichment';
import { buildFavoriteIdSet } from './playerListRows';

export function usePlayerListViewData({
    clockNow,
    context,
    currentUserId,
    currentUserLocation,
    currentUserSnapshot,
    gameLogDisabled,
    isGameRunning,
    knownUsersById,
    languageOptionsMap,
    loadStatus,
    moderationByUserId,
    playerSourceRows,
    profilesByUserId
}: any) {
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state: any) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state: any) => state.localFriendFavorites
    );
    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );

    const enrichedRows = useMemo(() => {
        return enrichPlayerListRows({
            clockNow,
            context,
            currentUserId,
            currentUserSnapshot,
            favoriteFriendIds,
            friendsById,
            knownUsersById,
            languageOptionsMap,
            moderationByUserId,
            playerSourceRows,
            profilesByUserId
        });
    }, [
        clockNow,
        context,
        currentUserId,
        currentUserSnapshot,
        favoriteFriendIds,
        friendsById,
        knownUsersById,
        languageOptionsMap,
        moderationByUserId,
        playerSourceRows,
        profilesByUserId
    ]);

    const filteredRows = isGameRunning ? enrichedRows : [];
    const headerPlayerCount = isGameRunning
        ? filteredRows.length || Number(context.playerCount) || 0
        : 0;
    const headerFriendCount = filteredRows.reduce(
        (total: any, row: any) => total + (row.isFriend ? 1 : 0),
        0
    );
    const parsedLocation = useMemo(
        () => parseLocation(context.location || currentUserLocation || ''),
        [context.location, currentUserLocation]
    );
    const isPlayerListSourceUnavailable = Boolean(
        !gameLogDisabled &&
        isGameRunning &&
        loadStatus === 'ready' &&
        context.source !== 'database' &&
        playerSourceRows.length === 0 &&
        !parsedLocation.isTraveling &&
        !parsedLocation.isOffline
    );

    return {
        filteredRows,
        headerFriendCount,
        headerPlayerCount,
        isPlayerListSourceUnavailable,
        parsedLocation,
        playerSourceRows
    };
}
