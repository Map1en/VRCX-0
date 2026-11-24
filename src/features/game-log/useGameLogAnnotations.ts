import { useMemo } from 'react';

import { normalizeGameLogId } from '@/components/game-log/gameLogRows';
import type { GameLogRow } from '@/components/game-log/gameLogTypes';
import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

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
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
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
