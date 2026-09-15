import { useMemo } from 'react';

import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import { parseLocation } from '@/shared/utils/location';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { enrichPlayerListRows } from './playerListEnrichment';
import type {
    PlayerListContext,
    PlayerListLocalModerationRecord,
    PlayerListProfileRecord,
    PlayerListSourceRow
} from './playerListTypes';

type PlayerListViewDataInput = {
    clockNow: number;
    context: PlayerListContext;
    currentUserId?: string | null;
    currentUserLocation?: string;
    currentUserSnapshot?: PlayerListProfileRecord | null;
    isGameRunning: boolean;
    knownUsersById: Record<string, PlayerListProfileRecord | null | undefined>;
    languageOptionsMap?: Parameters<
        typeof enrichPlayerListRows
    >[0]['languageOptionsMap'];
    loadStatus: string;
    moderationByUserId: Record<
        string,
        PlayerListLocalModerationRecord | null | undefined
    >;
    playerSourceRows: PlayerListSourceRow[];
    profilesByUserId: Record<
        string,
        PlayerListProfileRecord | null | undefined
    >;
};

export function usePlayerListViewData({
    clockNow,
    context,
    currentUserId,
    currentUserLocation,
    currentUserSnapshot,
    isGameRunning,
    knownUsersById,
    languageOptionsMap,
    loadStatus,
    moderationByUserId,
    playerSourceRows,
    profilesByUserId
}: PlayerListViewDataInput) {
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
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
        (total, row) => total + (row.isFriend ? 1 : 0),
        0
    );
    const parsedLocation = useMemo(
        () => parseLocation(context.location || currentUserLocation || ''),
        [context.location, currentUserLocation]
    );
    const isPlayerListSourceUnavailable = Boolean(
        isGameRunning &&
        loadStatus === 'ready' &&
        !context.playerFactsKnown &&
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
