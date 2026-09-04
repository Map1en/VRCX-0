import { useMemo } from 'react';

import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { buildGameLogFavoriteIdSet, normalizeGameLogId } from './gameLogRows';
import type { GameLogRow } from './gameLogTypes';

export function useGameLogAnnotations({ rows }: { rows: GameLogRow[] }) {
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const friendIdSignature = useFriendRosterStore((state) =>
        Object.keys(state.friendsById || {}).join(',')
    );
    const favoriteIdSet = useMemo(
        () =>
            buildGameLogFavoriteIdSet(
                remoteFavoriteFriendIds,
                localFriendFavorites
            ),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const friendIdSet = useMemo(
        () => new Set(friendIdSignature ? friendIdSignature.split(',') : []),
        [friendIdSignature]
    );
    const affinity = useMemo(
        () => ({ favoriteIdSet, friendIdSet }),
        [favoriteIdSet, friendIdSet]
    );
    const annotatedRows = useMemo(
        () =>
            rows.map((row) => {
                const normalizedUserId = normalizeGameLogId(row?.userId);
                return {
                    ...row,
                    isFavorite: normalizedUserId
                        ? favoriteIdSet.has(normalizedUserId)
                        : false,
                    isFriend: normalizedUserId
                        ? friendIdSet.has(normalizedUserId)
                        : false
                };
            }),
        [favoriteIdSet, friendIdSet, rows]
    );

    return {
        annotatedRows,
        affinity
    };
}
