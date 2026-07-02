import { useEffect, useMemo, useRef, useState } from 'react';

import type { FeedReadModelResult } from '@/domain/feed/feedReadModelTypes';
import feedRepository from '@/repositories/feedRepository';
import friendLogRepository from '@/repositories/friendLogRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

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

    async function mergeRowsWithLatestLive({
        rows,
        minLiveSequence,
        excludedUserIds,
        favoriteUserIds,
        requestIsCurrent
    }: {
        rows: FeedRow[];
        minLiveSequence: number;
        excludedUserIds: unknown[];
        favoriteUserIds: unknown[];
        requestIsCurrent(): boolean;
    }): Promise<FeedReadModelResult<FeedRow> | null> {
        let result: FeedReadModelResult<FeedRow> = {
            rows,
            maxSequence: minLiveSequence
        };
        let previousMaxSequence = minLiveSequence;
        while (requestIsCurrent()) {
            const liveFeedSnapshot = useFeedLiveStore.getState();
            result = await feedRepository.mergeLiveRows({
                rows: result.rows,
                userId: currentUserId,
                search: deferredSearchQuery,
                filters: activeFilters,
                excludedFavoriteUserIds: excludedUserIds,
                favoriteUserIds,
                dateFrom: toIsoRangeStart(dateFrom),
                dateTo: toIsoRangeEnd(dateTo),
                liveEntries: liveFeedSnapshot.entries,
                minLiveSequence: result.maxSequence,
                favoritesOnly,
                maxRows: maxFeedRows
            });
            if (!requestIsCurrent()) {
                return null;
            }
            const liveVersion = useFeedLiveStore.getState().version;
            if (
                liveVersion <= result.maxSequence ||
                result.maxSequence <= previousMaxSequence
            ) {
                return result;
            }
            previousMaxSequence = result.maxSequence;
        }
        return null;
    }

    async function prepareFullQueryRowsForCommit({
        result,
        excludedUserIds,
        favoriteUserIds,
        requestIsCurrent
    }: {
        result: FeedReadModelResult<FeedRow>;
        excludedUserIds: unknown[];
        favoriteUserIds: unknown[];
        requestIsCurrent(): boolean;
    }) {
        let nextResult = result;
        while (requestIsCurrent()) {
            liveMergeRequestIdRef.current += 1;
            if (useFeedLiveStore.getState().version <= nextResult.maxSequence) {
                return nextResult;
            }
            const mergedResult = await mergeRowsWithLatestLive({
                rows: nextResult.rows,
                excludedUserIds,
                favoriteUserIds,
                minLiveSequence: nextResult.maxSequence,
                requestIsCurrent
            });
            if (!mergedResult) {
                return null;
            }
            nextResult = mergedResult;
        }
        return null;
    }

    useEffect(() => {
        lastLiveFeedSequenceRef.current = useFeedLiveStore.getState().version;
    }, [currentUserId]);

    useEffect(() => {
        let active = true;
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
        const missingUserIds = [];
        const seenUserIds = new Set<string>();
        for (const row of rows) {
            const userId = resolveFeedUserId(row);
            if (
                !userId ||
                friendLogNamesById[userId] ||
                seenUserIds.has(userId)
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
                setFriendLogNamesById((current) => {
                    let changed = false;
                    const nextNamesById = {
                        ...current
                    };
                    for (const row of Array.isArray(statsRows)
                        ? statsRows
                        : []) {
                        const userId = normalizeId(row?.userId);
                        const displayName = resolveDisplayNameCandidate(
                            row?.displayName,
                            userId
                        );
                        if (userId && displayName && !nextNamesById[userId]) {
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
                const mergedResult = await mergeRowsWithLatestLive({
                    rows: result.rows,
                    excludedUserIds: hiddenUserIds,
                    favoriteUserIds,
                    minLiveSequence: result.maxSequence,
                    requestIsCurrent: () => requestIdRef.current === requestId
                });
                if (!mergedResult || requestIdRef.current !== requestId) {
                    return;
                }
                const commitResult = await prepareFullQueryRowsForCommit({
                    result: mergedResult,
                    excludedUserIds: hiddenUserIds,
                    favoriteUserIds,
                    requestIsCurrent: () => requestIdRef.current === requestId
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
        return useFeedLiveStore.subscribe((state, previousState) => {
            if (
                state.version === previousState?.version ||
                state.entries.length === 0
            ) {
                return;
            }
            const mergeRequestId = liveMergeRequestIdRef.current + 1;
            liveMergeRequestIdRef.current = mergeRequestId;
            const minLiveSequence = lastLiveFeedSequenceRef.current;
            mergeRowsWithLatestLive({
                rows: rowsRef.current,
                excludedUserIds: hiddenUserIds,
                favoriteUserIds: favoritesOnly ? Array.from(favoriteIdSet) : [],
                minLiveSequence,
                requestIsCurrent: () =>
                    liveMergeRequestIdRef.current === mergeRequestId
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
