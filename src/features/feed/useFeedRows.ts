import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    buildFeedFavoriteIdSet as buildFavoriteIdSet,
    normalizeFeedId as normalizeId,
    resolveDisplayNameCandidate,
    resolveFeedUserId,
    toIsoRangeEnd,
    toIsoRangeStart
} from '@/components/feed/feedRows';
import type {
    FeedFilterType,
    FeedLoadStatus,
    FeedRow
} from '@/components/feed/feedTypes';
import type { FeedCursor } from '@/repositories/feedPersistenceRepository';
import feedRepository from '@/repositories/feedRepository';
import friendLogRepository from '@/repositories/friendLogRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import type { FeedLiveMergeOptionsBuilder } from '@/services/feedLiveMergeService';
import {
    mergeFeedRowsWithLiveEntries,
    prepareFeedRowsForCommit
} from '@/services/feedLiveMergeService';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { useFriendLogStore } from '@/state/friendLogStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { subscribeFeedLiveMerge } from './feedLiveMergeScheduler';
import {
    appendUniqueFeedRows,
    FEED_PAGE_SIZE,
    retainFeedRowWindow,
    resolveLastFeedCursor
} from './feedPaging';

type UseFeedRowsOptions = {
    activeFilters: FeedFilterType[];
    dateFrom: string;
    dateTo: string;
    deferredSearchQuery: string;
    favoritesOnly: boolean;
    scopedUserIds: readonly string[];
    preferencesReady: boolean;
};

export function useFeedRows({
    activeFilters,
    dateFrom,
    dateTo,
    deferredSearchQuery,
    favoritesOnly,
    scopedUserIds,
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
    const feedPersistenceDisabled = usePreferencesStore(
        (state) => state.feedPersistenceDisabled
    );
    const friendLogRevision = useFriendLogStore((state) => state.revision);
    const [rows, setRows] = useState<FeedRow[]>([]);
    const [friendLogSeedNamesById, setFriendLogSeedNamesById] = useState<
        Record<string, string>
    >({});
    const [resolvedGameLogNamesById, setResolvedGameLogNamesById] = useState<
        Record<string, string>
    >({});
    const [loadStatus, setLoadStatus] = useState<FeedLoadStatus>('idle');
    const [hasMore, setHasMore] = useState(false);
    const [hasUnloadedLatest, setHasUnloadedLatest] = useState(false);
    const [latestReloadToken, setLatestReloadToken] = useState(0);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const cursorRef = useRef<FeedCursor | null>(null);
    const requestIdRef = useRef(0);
    const lastLiveFeedSequenceRef = useRef(0);
    const rowsRef = useRef(rows);
    const liveMergeRequestIdRef = useRef(0);
    const unresolvedUserIdsRef = useRef<Set<string>>(new Set());
    const viewingLatestRef = useRef(true);
    const hasUnloadedLatestRef = useRef(false);

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
    const searchMode = Boolean(
        deferredSearchQuery.trim() || scopedUserIds.length || dateFrom || dateTo
    );
    const favoriteUserIds = useMemo(
        () => (favoritesOnly ? Array.from(favoriteIdSet) : []),
        [favoriteIdSet, favoritesOnly]
    );
    const normalQueryKey = useMemo(
        () =>
            JSON.stringify({
                activeFilters,
                currentUserId,
                favoriteUserIds,
                feedPersistenceDisabled,
                hiddenUserIds,
                latestReloadToken,
                maxFeedRows
            }),
        [
            activeFilters,
            currentUserId,
            favoriteUserIds,
            feedPersistenceDisabled,
            hiddenUserIds,
            latestReloadToken,
            maxFeedRows
        ]
    );
    const friendLogNamesById = useMemo(
        () => ({ ...friendLogSeedNamesById, ...resolvedGameLogNamesById }),
        [friendLogSeedNamesById, resolvedGameLogNamesById]
    );

    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    const updateHasUnloadedLatest = useCallback((value: boolean) => {
        hasUnloadedLatestRef.current = value;
        setHasUnloadedLatest((current) =>
            current === value ? current : value
        );
    }, []);

    const setViewingLatest = useCallback((value: boolean) => {
        viewingLatestRef.current = value && !hasUnloadedLatestRef.current;
    }, []);

    const reloadLatest = useCallback(() => {
        viewingLatestRef.current = true;
        updateHasUnloadedLatest(false);
        setLatestReloadToken((current) => current + 1);
    }, [updateHasUnloadedLatest]);

    const commitRowsToWindow = useCallback(
        (nextRows: FeedRow[], edge: 'latest' | 'oldest') => {
            const retainedRows = retainFeedRowWindow(
                nextRows,
                maxFeedRows,
                edge
            );
            if (retainedRows !== nextRows) {
                if (edge === 'latest') {
                    cursorRef.current = resolveLastFeedCursor(retainedRows);
                    if (
                        !feedPersistenceDisabled &&
                        cursorRef.current !== null
                    ) {
                        setHasMore(true);
                    }
                } else {
                    updateHasUnloadedLatest(true);
                }
            }
            rowsRef.current = retainedRows;
            setRows(retainedRows);
        },
        [feedPersistenceDisabled, maxFeedRows, updateHasUnloadedLatest]
    );

    useEffect(() => {
        rowsRef.current = [];
        cursorRef.current = null;
        viewingLatestRef.current = true;
        setRows([]);
        setHasMore(false);
        setLoadingOlder(false);
        updateHasUnloadedLatest(false);
    }, [feedPersistenceDisabled, updateHasUnloadedLatest]);

    const createMergeOptionsBuilder = useCallback(
        ({
            excludedUserIds,
            favoriteUserIds
        }: {
            excludedUserIds: string[];
            favoriteUserIds: string[];
        }): FeedLiveMergeOptionsBuilder =>
            ({ liveEntries, rows }) => ({
                rows,
                userId: currentUserId || '',
                search: deferredSearchQuery,
                filters: activeFilters,
                excludedFavoriteUserIds: excludedUserIds,
                favoriteUserIds,
                scopedUserIds,
                dateFrom: toIsoRangeStart(dateFrom),
                dateTo: toIsoRangeEnd(dateTo),
                favoritesOnly,
                maxRows: Math.max(
                    rows.length + liveEntries.length,
                    rows.length + FEED_PAGE_SIZE
                )
            }),
        [
            activeFilters,
            currentUserId,
            dateFrom,
            dateTo,
            deferredSearchQuery,
            favoritesOnly,
            scopedUserIds
        ]
    );

    useEffect(() => {
        lastLiveFeedSequenceRef.current = useFeedLiveStore.getState().version;
    }, [currentUserId, feedPersistenceDisabled]);

    useEffect(() => {
        let active = true;
        unresolvedUserIdsRef.current = new Set();
        setResolvedGameLogNamesById({});
        const normalizedCurrentUserId = normalizeId(currentUserId);
        if (!normalizedCurrentUserId) {
            setFriendLogSeedNamesById({});
            return () => {
                active = false;
            };
        }
        friendLogRepository
            .getFriendLogCurrent(normalizedCurrentUserId)
            .then((entries) => {
                if (!active) {
                    return;
                }
                const nextNamesById: Record<string, string> = {};
                for (const entry of entries) {
                    const userId = normalizeId(entry?.userId);
                    const displayName = resolveDisplayNameCandidate(
                        entry?.displayName,
                        userId
                    );
                    if (userId && displayName) {
                        nextNamesById[userId] = displayName;
                    }
                }
                setFriendLogSeedNamesById(nextNamesById);
            })
            .catch(() => {
                if (active) {
                    setFriendLogSeedNamesById({});
                }
            });
        return () => {
            active = false;
        };
    }, [currentUserId, friendLogRevision]);

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
            .then((statsRows) => {
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
                setResolvedGameLogNamesById((current) => {
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
        const currentUserIds = new Set(
            rows.map(resolveFeedUserId).filter(Boolean)
        );
        unresolvedUserIdsRef.current = new Set(
            Array.from(unresolvedUserIdsRef.current).filter((userId) =>
                currentUserIds.has(userId)
            )
        );
        setResolvedGameLogNamesById((current) => {
            const retainedEntries = Object.entries(current).filter(([userId]) =>
                currentUserIds.has(userId)
            );
            return retainedEntries.length === Object.keys(current).length
                ? current
                : Object.fromEntries(retainedEntries);
        });
    }, [rows]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }
        if (!currentUserId) {
            requestIdRef.current += 1;
            viewingLatestRef.current = true;
            updateHasUnloadedLatest(false);
            setRows([]);
            setLoadStatus('idle');
            return;
        }
        if (favoritesOnly && !isFavoritesLoaded) {
            requestIdRef.current += 1;
            viewingLatestRef.current = true;
            updateHasUnloadedLatest(false);
            setLoadStatus('idle');
            setRows([]);
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        cursorRef.current = null;
        setHasMore(false);
        setLoadingOlder(false);
        if (!searchMode) {
            viewingLatestRef.current = true;
            updateHasUnloadedLatest(false);
        }
        const liveFeedSequenceAtRequestStart =
            useFeedLiveStore.getState().version;
        setLoadStatus('running');
        if (searchMode) {
            feedRepository
                .queryFeed({
                    userId: currentUserId,
                    search: deferredSearchQuery,
                    filters: activeFilters,
                    excludedFavoriteUserIds: hiddenUserIds,
                    favoriteUserIds,
                    scopedUserIds,
                    dateFrom: toIsoRangeStart(dateFrom),
                    dateTo: toIsoRangeEnd(dateTo),
                    favoritesOnly
                })
                .then((searchRows) => {
                    if (requestIdRef.current !== requestId) {
                        return;
                    }
                    rowsRef.current = searchRows;
                    setRows(searchRows);
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
            return;
        }
        feedRepository
            .queryFeedLatest({
                userId: currentUserId,
                filters: activeFilters,
                excludedFavoriteUserIds: hiddenUserIds,
                favoriteUserIds,
                scopedUserIds,
                favoritesOnly,
                maxRows: FEED_PAGE_SIZE
            })
            .then(async (result) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                const buildMergeOptions = createMergeOptionsBuilder({
                    excludedUserIds: hiddenUserIds,
                    favoriteUserIds
                });
                cursorRef.current = result.persistedCursor ?? null;
                setHasMore(
                    !feedPersistenceDisabled &&
                        result.persistedHasMore === true &&
                        cursorRef.current !== null
                );
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
                lastLiveFeedSequenceRef.current = maxSequence;
                commitRowsToWindow(commitResult.rows, 'latest');
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
        commitRowsToWindow,
        createMergeOptionsBuilder,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteUserIds,
        favoritesOnly,
        feedPersistenceDisabled,
        hiddenUserIds,
        isFavoritesLoaded,
        latestReloadToken,
        preferencesReady,
        searchMode,
        scopedUserIds,
        updateHasUnloadedLatest
    ]);

    useEffect(() => {
        liveMergeRequestIdRef.current += 1;
        if (!preferencesReady || !currentUserId || searchMode) {
            return undefined;
        }
        return subscribeFeedLiveMerge(() => {
            const mergeRequestId = liveMergeRequestIdRef.current + 1;
            liveMergeRequestIdRef.current = mergeRequestId;
            const minLiveSequence = lastLiveFeedSequenceRef.current;
            mergeFeedRowsWithLiveEntries({
                buildMergeOptions: createMergeOptionsBuilder({
                    excludedUserIds: hiddenUserIds,
                    favoriteUserIds
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
                    commitRowsToWindow(
                        result.rows,
                        viewingLatestRef.current ? 'latest' : 'oldest'
                    );
                })
                .catch((error: unknown) => {
                    console.error(error);
                });
        });
    }, [
        commitRowsToWindow,
        createMergeOptionsBuilder,
        currentUserId,
        favoriteUserIds,
        hiddenUserIds,
        preferencesReady,
        searchMode
    ]);

    const loadOlder = useCallback(() => {
        const cursor = cursorRef.current;
        if (
            searchMode ||
            loadingOlder ||
            loadStatus !== 'ready' ||
            !hasMore ||
            feedPersistenceDisabled ||
            !cursor ||
            !currentUserId
        ) {
            return;
        }
        const requestId = requestIdRef.current;
        setLoadingOlder(true);
        feedRepository
            .queryFeedPage({
                userId: currentUserId,
                filters: activeFilters,
                excludedFavoriteUserIds: hiddenUserIds,
                favoriteUserIds,
                favoritesOnly,
                maxEntries: FEED_PAGE_SIZE,
                cursor
            })
            .then((pageRows) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                const nextCursor = resolveLastFeedCursor(pageRows);
                cursorRef.current = nextCursor;
                setHasMore(
                    nextCursor !== null && pageRows.length >= FEED_PAGE_SIZE
                );
                commitRowsToWindow(
                    appendUniqueFeedRows(rowsRef.current, pageRows),
                    'oldest'
                );
            })
            .catch((error: unknown) => {
                if (requestIdRef.current === requestId) {
                    setHasMore(false);
                }
                console.error(error);
            })
            .finally(() => {
                if (requestIdRef.current === requestId) {
                    setLoadingOlder(false);
                }
            });
    }, [
        activeFilters,
        commitRowsToWindow,
        currentUserId,
        favoriteUserIds,
        favoritesOnly,
        feedPersistenceDisabled,
        hasMore,
        hiddenUserIds,
        loadingOlder,
        loadStatus,
        searchMode
    ]);

    return {
        friendLogNamesById,
        hasMore,
        hasUnloadedLatest,
        isFavoritesLoaded,
        loadOlder,
        loadStatus,
        loadingOlder,
        normalQueryKey,
        reloadLatest,
        searchMode,
        setViewingLatest,
        rows
    };
}
