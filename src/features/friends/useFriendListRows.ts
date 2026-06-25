import { useEffect, useMemo, useRef, useState } from 'react';

import { applyFactDerivedFields } from '@/domain/friends/friendRosterFacts';
import { useKnownUserFacts } from '@/domain/users/useKnownUser';
import gameLogRepository from '@/repositories/gameLogRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import mutualGraphPersistenceRepository from '@/repositories/mutualGraphPersistenceRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    buildFriendListFavoriteIdSet as buildFavoriteIdSet,
    buildFriendListUserStatsById as buildUserStatsById,
    filterFriendListRows,
    normalizeFriendListId as normalizeId
} from './friendListRows';

export function useFriendListRows({
    activeSearchFilterIds,
    favoritesOnly,
    searchQuery
}: {
    activeSearchFilterIds: Set<unknown>;
    favoritesOnly: boolean;
    searchQuery: string;
}) {
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const isFavoritesLoaded = useSessionStore(
        (state: any) => state.isFavoritesLoaded
    );
    const friendLoadStatus = useFriendRosterStore(
        (state: any) => state.loadStatus
    );
    const friendDetail = useFriendRosterStore((state: any) => state.detail);
    const orderedFriendIds = useFriendRosterStore(
        (state: any) => state.orderedFriendIds
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const applyFriendPatches = useFriendRosterStore(
        (state: any) => state.applyFriendPatches
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state: any) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state: any) => state.localFriendFavorites
    );
    const statsHydrationRequestRef = useRef(0);
    const [userMemoById, setUserMemoById] = useState(() => new Map());
    const [userNoteById, setUserNoteById] = useState(() => new Map());
    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const factsById = useKnownUserFacts(orderedFriendIds);
    const rosterRows = useMemo(
        () =>
            orderedFriendIds
                .map((friendId: any, index: any) => {
                    const rosterFriend = friendsById[friendId];
                    if (!rosterFriend) {
                        return null;
                    }
                    const friend = applyFactDerivedFields(
                        rosterFriend,
                        factsById[friendId]
                    );
                    const friendNumber =
                        Number.parseInt(
                            String(
                                friend.$friendNumber ?? friend.friendNumber ?? 0
                            ),
                            10
                        ) || 0;
                    if (friendNumber > 0) {
                        return friend;
                    }
                    return {
                        ...friend,
                        friendNumber: index + 1,
                        $friendNumber: index + 1
                    };
                })
                .filter(Boolean),
        [friendsById, orderedFriendIds, factsById]
    );
    const rosterStatsKey = useMemo(
        () =>
            rosterRows
                .map(
                    (friend: any) =>
                        `${normalizeId(friend?.id)}:${friend?.displayName || ''}`
                )
                .join('\u0001'),
        [rosterRows]
    );
    const filteredRows = useMemo(() => {
        return filterFriendListRows({
            rosterRows,
            favoritesOnly,
            favoriteFriendIds,
            searchQuery,
            activeSearchFilterIds,
            userMemoById,
            userNoteById
        });
    }, [
        activeSearchFilterIds,
        favoriteFriendIds,
        favoritesOnly,
        rosterRows,
        searchQuery,
        userMemoById,
        userNoteById
    ]);

    useEffect(() => {
        let active = true;
        Promise.all([
            memoPersistenceRepository.getAllUserMemos(),
            memoPersistenceRepository.getAllUserNotes(currentUserId)
        ])
            .then(([memoRows, noteRows]: any) => {
                if (!active) {
                    return;
                }
                const nextMemos = new Map();
                for (const row of Array.isArray(memoRows) ? memoRows : []) {
                    const userId = normalizeId(row?.userId);
                    if (userId) {
                        nextMemos.set(userId, row?.memo || '');
                    }
                }
                const nextNotes = new Map();
                for (const row of Array.isArray(noteRows) ? noteRows : []) {
                    const userId = normalizeId(row?.userId);
                    if (userId) {
                        nextNotes.set(userId, row?.note || '');
                    }
                }
                setUserMemoById(nextMemos);
                setUserNoteById(nextNotes);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [currentUserId]);

    useEffect(() => {
        if (!rosterRows.length) {
            return undefined;
        }
        let active = true;
        const requestId = statsHydrationRequestRef.current + 1;
        statsHydrationRequestRef.current = requestId;
        const userIds = rosterRows
            .map((friend: any) => normalizeId(friend?.id))
            .filter(Boolean);
        const displayNames = rosterRows
            .map((friend: any) => String(friend?.displayName || '').trim())
            .filter(Boolean);
        const mutualSnapshotPromise = currentUserId
            ? mutualGraphPersistenceRepository
                  .getSnapshot(currentUserId)
                  .then(({ snapshot, meta }: any) => {
                      const countMap = new Map();
                      for (const [friendId, mutualIds] of snapshot) {
                          countMap.set(friendId, mutualIds.length);
                      }
                      return [countMap, meta];
                  })
            : Promise.resolve([new Map(), new Map()]);
        Promise.all([
            gameLogRepository.getAllUserStats({
                userIds,
                displayNames
            }),
            mutualSnapshotPromise
        ])
            .then(([statsRows, [mutualCountMap, mutualMetaMap]]: any) => {
                if (!active || statsHydrationRequestRef.current !== requestId) {
                    return;
                }
                const statsById = buildUserStatsById(statsRows, rosterRows);
                const patches = [];
                for (const friend of rosterRows) {
                    const friendId = normalizeId(friend?.id);
                    if (!friendId) {
                        continue;
                    }
                    const stats = statsById.get(friendId);
                    const mutualCount =
                        Number.parseInt(
                            mutualCountMap instanceof Map
                                ? mutualCountMap.get(friendId)
                                : 0,
                            10
                        ) || 0;
                    const mutualOptedOut = Boolean(
                        mutualMetaMap instanceof Map
                            ? mutualMetaMap.get(friendId)?.optedOut
                            : false
                    );
                    const patch: any = {
                        $mutualCount: mutualCount,
                        $mutualOptedOut: mutualOptedOut
                    };
                    if (stats) {
                        patch.$joinCount = stats.joinCount;
                        patch.$lastSeen = stats.lastSeen;
                        patch.$timeSpent = stats.timeSpent;
                    }
                    if (
                        (stats &&
                            (friend.$joinCount !== patch.$joinCount ||
                                friend.$lastSeen !== patch.$lastSeen ||
                                friend.$timeSpent !== patch.$timeSpent)) ||
                        (Number.parseInt(friend.$mutualCount ?? 0, 10) || 0) !==
                            mutualCount ||
                        Boolean(friend.$mutualOptedOut) !== mutualOptedOut
                    ) {
                        patches.push({
                            userId: friendId,
                            patch,
                            stateBucket:
                                friend.stateBucket || friend.state || 'offline'
                        });
                    }
                }
                if (patches.length) {
                    applyFriendPatches(patches);
                }
            })
            .catch((error: any) => {
                console.warn(
                    '[FriendListPage] Failed to hydrate friend stats',
                    error
                );
            });
        return () => {
            active = false;
        };
    }, [applyFriendPatches, currentUserId, rosterStatsKey]);

    return {
        currentUserId,
        currentUserSnapshot,
        filteredRows,
        friendDetail,
        friendLoadStatus,
        friendsById,
        isFavoritesLoaded,
        rosterRows
    };
}
