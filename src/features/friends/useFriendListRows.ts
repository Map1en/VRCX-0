import { useEffect, useMemo, useRef, useState } from 'react';

import { applyFactDerivedFields } from '@/domain/friends/friendRosterFacts';
import { useKnownUserFacts } from '@/lib/useKnownUser';
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
    type FriendListRow,
    type FriendListStatsPatch,
    type FriendListUserStatsRow,
    type FriendMemoRow,
    type FriendNoteRow,
    normalizeFriendListId as normalizeId
} from './friendListRows';

function isPresent<T>(value: T | null | undefined): value is T {
    return value != null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeStatsRows(value: unknown): FriendListUserStatsRow[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeMemoRows(value: unknown): FriendMemoRow[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeNoteRows(value: unknown): FriendNoteRow[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readMutualOptedOut(value: unknown): boolean {
    return isRecord(value) && value.optedOut === true;
}

export function useFriendListRows({
    activeSearchFilterIds,
    favoritesOnly,
    searchQuery
}: {
    activeSearchFilterIds: Set<string>;
    favoritesOnly: boolean;
    searchQuery: string;
}) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const friendLoadStatus = useFriendRosterStore((state) => state.loadStatus);
    const friendDetail = useFriendRosterStore((state) => state.detail);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const applyFriendPatches = useFriendRosterStore(
        (state) => state.applyFriendPatches
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const statsHydrationRequestRef = useRef(0);
    const [userMemoById, setUserMemoById] = useState(
        () => new Map<string, string>()
    );
    const [userNoteById, setUserNoteById] = useState(
        () => new Map<string, string>()
    );
    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const factsById = useKnownUserFacts(orderedFriendIds);
    const rosterRows = useMemo<FriendListRow[]>(
        () =>
            orderedFriendIds
                .map((friendId, index) => {
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
                .filter(isPresent),
        [friendsById, orderedFriendIds, factsById]
    );
    const rosterStatsKey = useMemo(
        () =>
            rosterRows
                .map(
                    (friend) =>
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
            .then(([memoRows, noteRows]) => {
                if (!active) {
                    return;
                }
                const nextMemos = new Map<string, string>();
                for (const row of normalizeMemoRows(memoRows)) {
                    const userId = normalizeId(row?.userId);
                    if (userId) {
                        nextMemos.set(userId, String(row?.memo || ''));
                    }
                }
                const nextNotes = new Map<string, string>();
                for (const row of normalizeNoteRows(noteRows)) {
                    const userId = normalizeId(row?.userId);
                    if (userId) {
                        nextNotes.set(userId, String(row?.note || ''));
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
            .map((friend) => normalizeId(friend?.id))
            .filter(Boolean);
        const displayNames = rosterRows
            .map((friend) => String(friend?.displayName || '').trim())
            .filter(Boolean);
        const mutualSnapshotPromise = currentUserId
            ? mutualGraphPersistenceRepository
                  .getSnapshot(currentUserId)
                  .then(({ snapshot, meta }) => {
                      const countMap = new Map<string, number>();
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
            .then(([statsRows, [mutualCountMap, mutualMetaMap]]) => {
                if (!active || statsHydrationRequestRef.current !== requestId) {
                    return;
                }
                const normalizedStatsRows = normalizeStatsRows(statsRows);
                const statsById = buildUserStatsById(
                    normalizedStatsRows,
                    rosterRows
                );
                const patches: FriendListStatsPatch[] = [];
                for (const friend of rosterRows) {
                    const friendId = normalizeId(friend?.id);
                    if (!friendId) {
                        continue;
                    }
                    const stats = statsById.get(friendId);
                    const mutualCount =
                        Number.parseInt(
                            String(mutualCountMap.get(friendId) ?? 0),
                            10
                        ) || 0;
                    const mutualOptedOut = Boolean(
                        readMutualOptedOut(mutualMetaMap.get(friendId))
                    );
                    const patch: FriendListStatsPatch['patch'] = {
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
                        (Number.parseInt(
                            String(friend.$mutualCount ?? 0),
                            10
                        ) || 0) !== mutualCount ||
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
            .catch((error: unknown) => {
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
