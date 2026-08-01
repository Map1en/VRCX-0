import { useEffect, useMemo, useRef, useState } from 'react';

import feedRepository from '@/repositories/feedRepository';
import friendLogRepository from '@/repositories/friendLogRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import type { FeedLiveMergeOptionsBuilder } from './feedLiveMerge';
import {
    mergeFeedRowsWithLiveEntries,
    prepareFeedRowsForCommit
} from './feedLiveMerge';
import { subscribeFeedLiveMerge } from './feedLiveMergeScheduler';
import {
    buildFeedFavoriteIdSet as buildFavoriteIdSet,
    normalizeFeedId as normalizeId,
    resolveDisplayNameCandidate,
    resolveFeedUserId,
    toIsoRangeEnd,
    toIsoRangeStart
} from './feedRows';
import type { FeedFilterType, FeedLoadStatus, FeedRow } from './feedTypes';

type UseFeedRowsOptions = {
    activeFilters: FeedFilterType[];
    dateFrom: string;
    dateTo: string;
    deferredSearchQuery: string;
    favoritesOnly: boolean;
    preferencesReady: boolean;
};

export function useFeedRows({
    activeFilters,
    dateFrom,
    dateTo,
    deferredSearchQuery,
    favoritesOnly,
    preferencesReady
}: UseFeedRowsOptions) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const remoteFavoritesById = useFavoriteStore(
        (state) => state.remoteFavoritesById
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const favoriteGroupFilterIds = usePreferencesStore(
        (state) => state.localFavoriteFriendsGroups
    );
    const feedHiddenUsers = usePreferencesStore(
        (state) => state.feedHiddenUsers
    );
    const maxFeedRows = usePreferencesStore(
        (state) => state.tableLimits.maxTableSize
    );
    const friendRosterLastLoadedAt = useFriendRosterStore(
        (state) => state.lastLoadedAt
    );
    const [rows, setRows] = useState<FeedRow[]>([]);
    const [friendLogNamesById, setFriendLogNamesById] = useState<
        Record<string, string>
    >({});
    const [loadStatus, setLoadStatus] = useState<FeedLoadStatus>('idle');
    const requestIdRef = useRef(0);
    const lastLiveFeedSequenceRef = useRef(0);
    const rowsRef = useRef(rows);
    const liveMergeRequestIdRef = useRef(0);
    const unresolvedUserIdsRef = useRef<Set<string>>(new Set());

    const favoriteIdSet = useMemo(
        () =>
            buildFavoriteIdSet(
                remoteFavoritesById,
                localFriendFavorites,
                favoriteGroupFilterIds
            ),
        [favoriteGroupFilterIds, localFriendFavorites, remoteFavoritesById]
    );
    const hiddenUserIds = feedHiddenUsers;

    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    function createMergeOptionsBuilder({
        excludedUserIds,
        favoriteUserIds
    }: {
        excludedUserIds: unknown[];
        favoriteUserIds: unknown[];
    }): FeedLiveMergeOptionsBuilder {
        return ({ liveEntries, minLiveSequence, rows }) => ({
            rows,
            userId: currentUserId,
            search: deferredSearchQuery,
            filters: activeFilters,
            excludedFavoriteUserIds: excludedUserIds,
            favoriteUserIds,
            dateFrom: toIsoRangeStart(dateFrom),
            dateTo: toIsoRangeEnd(dateTo),
            liveEntries,
            minLiveSequence,
            favoritesOnly,
            maxRows: maxFeedRows
        });
    }

    useEffect(() => {
        lastLiveFeedSequenceRef.current = useFeedLiveStore.getState().version;
    }, [currentUserId]);

    useEffect(() => {
        let active = true;
        unresolvedUserIdsRef.current = new Set();
        const normalizedCurrentUserId = normalizeId(currentUserId);
        if (!normalizedCurrentUserId) {
            setFriendLogNamesById({});
            return () => {
                active = false;
            };
        }
        friendLogRepository
            .getFriendLogCurrent(normalizedCurrentUserId)
            .then((entries: unknown) => {
                if (!active) {
                    return;
                }
                const nextNamesById: Record<string, string> = {};
                for (const entry of Array.isArray(entries) ? entries : []) {
                    const userId = normalizeId(entry?.userId);
                    const displayName = resolveDisplayNameCandidate(
                        entry?.displayName,
                        userId
                    );
                    if (userId && displayName) {
                        nextNamesById[userId] = displayName;
                    }
                }
                setFriendLogNamesById(nextNamesById);
            })
            .catch(() => {
                if (active) {
                    setFriendLogNamesById({});
                }
            });
        return () => {
            active = false;
        };
    }, [currentUserId, friendRosterLastLoadedAt]);

    useEffect(() => {
        const missingUserIds: string[] = [];
        const seenUserIds = new Set<string>();
        for (const row of rows) {
            const userId = resolveFeedUserId(row);
            if (
                !userId ||
                friendLogNamesById[userId] ||
                seenUserIds.has(userId) ||
                unresolvedUserIdsRef.current.has(userId)
            ) {
                continue;
            }
            if (resolveDisplayNameCandidate(row?.displayName, userId)) {
                continue;
            }
            seenUserIds.add(userId);
            missingUserIds.push(userId);
            if (missingUserIds.length >= 100) {
                break;
            }
        }
        if (missingUserIds.length === 0) {
            return undefined;
        }
        let active = true;
        gameLogRepository
            .getAllUserStats({
                userIds: missingUserIds
            })
            .then((statsRows: unknown) => {
                if (!active) {
                    return;
                }
                const resolvedNamesById: Record<string, string> = {};
                for (const row of Array.isArray(statsRows) ? statsRows : []) {
                    const userId = normalizeId(row?.userId);
                    const displayName = resolveDisplayNameCandidate(
                        row?.displayName,
                        userId
                    );
                    if (userId && displayName) {
                        resolvedNamesById[userId] = displayName;
                    }
                }
                for (const userId of missingUserIds) {
                    if (!resolvedNamesById[userId]) {
                        unresolvedUserIdsRef.current.add(userId);
                    }
                }
                setFriendLogNamesById((current) => {
                    let changed = false;
                    const nextNamesById = {
                        ...current
                    };
                    for (const [userId, displayName] of Object.entries(
                        resolvedNamesById
                    )) {
                        if (!nextNamesById[userId]) {
                            nextNamesById[userId] = displayName;
                            changed = true;
                        }
                    }
                    return changed ? nextNamesById : current;
                });
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [friendLogNamesById, rows]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }
        if (!currentUserId) {
            requestIdRef.current += 1;
            setRows([]);
            setLoadStatus('idle');
            return;
        }
        if (favoritesOnly && !isFavoritesLoaded) {
            requestIdRef.current += 1;
            setLoadStatus('idle');
            setRows([]);
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const favoriteUserIds = favoritesOnly ? Array.from(favoriteIdSet) : [];
        const liveFeedSequenceAtRequestStart =
            useFeedLiveStore.getState().version;
        setLoadStatus('running');
        feedRepository
            .queryFeedReadModel({
                userId: currentUserId,
                search: deferredSearchQuery,
                filters: activeFilters,
                excludedFavoriteUserIds: hiddenUserIds,
                favoriteUserIds,
                dateFrom: toIsoRangeStart(dateFrom),
                dateTo: toIsoRangeEnd(dateTo),
                liveEntries: [],
                minLiveSequence: liveFeedSequenceAtRequestStart,
                favoritesOnly,
                maxRows: maxFeedRows
            })
            .then(async (result) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                const buildMergeOptions = createMergeOptionsBuilder({
                    excludedUserIds: hiddenUserIds,
                    favoriteUserIds
                });
                const mergedResult = await mergeFeedRowsWithLiveEntries({
                    buildMergeOptions,
                    minLiveSequence: result.maxSequence,
                    requestIsCurrent: () => requestIdRef.current === requestId,
                    rows: result.rows
                });
                if (!mergedResult || requestIdRef.current !== requestId) {
                    return;
                }
                const commitResult = await prepareFeedRowsForCommit({
                    buildMergeOptions,
                    onMergeRound: () => {
                        liveMergeRequestIdRef.current += 1;
                    },
                    requestIsCurrent: () => requestIdRef.current === requestId,
                    result: mergedResult
                });
                if (!commitResult || requestIdRef.current !== requestId) {
                    return;
                }
                const maxSequence = Math.max(
                    commitResult.maxSequence,
                    liveFeedSequenceAtRequestStart
                );
                if (maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = maxSequence;
                }
                rowsRef.current = commitResult.rows;
                setRows(commitResult.rows);
                setLoadStatus('ready');
            })
            .catch((error: unknown) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setRows([]);
                setLoadStatus('error');
                console.error(error);
            });
    }, [
        activeFilters,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        hiddenUserIds,
        isFavoritesLoaded,
        maxFeedRows,
        preferencesReady
    ]);

    useEffect(() => {
        liveMergeRequestIdRef.current += 1;
        if (!preferencesReady || !currentUserId) {
            return undefined;
        }
        return subscribeFeedLiveMerge(() => {
            const mergeRequestId = liveMergeRequestIdRef.current + 1;
            liveMergeRequestIdRef.current = mergeRequestId;
            const minLiveSequence = lastLiveFeedSequenceRef.current;
            mergeFeedRowsWithLiveEntries({
                buildMergeOptions: createMergeOptionsBuilder({
                    excludedUserIds: hiddenUserIds,
                    favoriteUserIds: favoritesOnly
                        ? Array.from(favoriteIdSet)
                        : []
                }),
                minLiveSequence,
                requestIsCurrent: () =>
                    liveMergeRequestIdRef.current === mergeRequestId,
                rows: rowsRef.current
            })
                .then((result) => {
                    if (!result) {
                        return;
                    }
                    if (liveMergeRequestIdRef.current !== mergeRequestId) {
                        return;
                    }
                    if (result.maxSequence > lastLiveFeedSequenceRef.current) {
                        lastLiveFeedSequenceRef.current = result.maxSequence;
                    }
                    rowsRef.current = result.rows;
                    setRows(result.rows);
                })
                .catch((error: unknown) => {
                    console.error(error);
                });
        });
    }, [
        activeFilters,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        hiddenUserIds,
        maxFeedRows,
        preferencesReady
    ]);

    return {
        friendLogNamesById,
        isFavoritesLoaded,
        loadStatus,
        rows
    };
}
