import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FeedReadModelResult } from '@/domain/feed/feedReadModelTypes';
import type { FeedCursor } from '@/repositories/feedPersistenceRepository';
import feedRepository from '@/repositories/feedRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    buildFeedColumnExcludedFavoriteIds,
    buildFeedColumnFavoriteIds
} from '../feedColumnScope';
import type { FeedColumnConfig } from '../feedColumnsState';
import { getFeedRowId, normalizeFeedId as normalizeId } from '../feedRows';
import type { FeedLoadStatus, FeedRow } from '../feedTypes';

const FEED_COLUMN_PAGE_SIZE = 80;

export function resolveFeedColumnInitialLiveSequence(value: unknown) {
    const sequence = Number(value);
    return Number.isFinite(sequence) && sequence > 0 ? sequence : 0;
}

function resolveFeedCursor(row: FeedRow): FeedCursor | null {
    const createdAt = normalizeId(row?.created_at || row?.createdAt);
    const sourceRank = Number(row?.sourceRank ?? row?.source_rank);
    const rowId = Number(row?.rowId ?? row?.row_id);
    if (!createdAt || !Number.isFinite(sourceRank) || !Number.isFinite(rowId)) {
        return null;
    }
    return {
        createdAt,
        sourceRank,
        rowId
    };
}

function resolveLastFeedCursor(rows: FeedRow[]): FeedCursor | null {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const cursor = resolveFeedCursor(rows[index]);
        if (cursor) {
            return cursor;
        }
    }
    return null;
}

function appendUniqueRows(currentRows: FeedRow[], nextRows: FeedRow[]) {
    const seen = new Set(currentRows.map(getFeedRowId));
    const output = [...currentRows];
    for (const row of nextRows) {
        const key = getFeedRowId(row);
        if (!seen.has(key)) {
            seen.add(key);
            output.push(row);
        }
    }
    return output;
}

export function useFeedColumnRows(column: FeedColumnConfig) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const remoteFavoritesById = useFavoriteStore(
        (state) => state.remoteFavoritesById
    );
    const feedHiddenUsers = usePreferencesStore(
        (state) => state.feedHiddenUsers
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const [rows, setRows] = useState<FeedRow[]>([]);
    const [loadStatus, setLoadStatus] = useState<FeedLoadStatus>('idle');
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const cursorRef = useRef<FeedCursor | null>(null);
    const requestIdRef = useRef(0);
    const liveMergeRequestIdRef = useRef(0);
    const liveSequenceRef = useRef(0);
    const rowsRef = useRef(rows);

    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    const favoriteUserIds = useMemo(
        () =>
            Array.from(
                buildFeedColumnFavoriteIds({
                    column,
                    localFriendFavorites,
                    remoteFavoritesById
                })
            ),
        [column, localFriendFavorites, remoteFavoritesById]
    );
    const hiddenUserIds = feedHiddenUsers;
    const columnExcludedFavoriteUserIds = useMemo(
        () =>
            Array.from(
                buildFeedColumnExcludedFavoriteIds({
                    column,
                    localFriendFavorites,
                    remoteFavoritesById
                })
            ),
        [column, localFriendFavorites, remoteFavoritesById]
    );
    const excludedFavoriteUserIds = useMemo(
        () =>
            Array.from(
                new Set([...columnExcludedFavoriteUserIds, ...hiddenUserIds])
            ),
        [columnExcludedFavoriteUserIds, hiddenUserIds]
    );
    const excludedGroupKeys = column.friendScope.excludedFavoriteGroupKeys;
    const excludesFavoriteGroups = Boolean(
        excludedGroupKeys === 'all' ||
        (Array.isArray(excludedGroupKeys) && excludedGroupKeys.length)
    );

    const favoritesReady =
        (column.friendScope.kind !== 'favorites' && !excludesFavoriteGroups) ||
        isFavoritesLoaded;
    const scopeHasRows =
        column.friendScope.kind !== 'favorites' || favoriteUserIds.length > 0;
    const queryKey = useMemo(
        () =>
            JSON.stringify({
                columnId: column.id,
                currentUserId: normalizeId(currentUserId),
                excludedFavoriteUserIds,
                favoriteUserIds,
                feedTypes: column.feedTypes,
                scope: column.friendScope
            }),
        [column, currentUserId, excludedFavoriteUserIds, favoriteUserIds]
    );

    const mergeWithLiveRows = useCallback(
        async ({
            minLiveSequence,
            requestIsCurrent,
            rows
        }: {
            minLiveSequence: number;
            requestIsCurrent(): boolean;
            rows: FeedRow[];
        }) => {
            let result: FeedReadModelResult<FeedRow> = {
                rows,
                maxSequence: minLiveSequence
            };
            let previousMaxSequence = minLiveSequence;
            while (requestIsCurrent()) {
                const liveSnapshot = useFeedLiveStore.getState();
                const maxRows = Math.max(
                    result.rows.length + liveSnapshot.entries.length,
                    result.rows.length + FEED_COLUMN_PAGE_SIZE
                );
                result = await feedRepository.mergeLiveRows({
                    rows: result.rows,
                    userId: currentUserId,
                    filters: column.feedTypes,
                    excludedFavoriteUserIds,
                    favoriteUserIds,
                    liveEntries: liveSnapshot.entries,
                    minLiveSequence: result.maxSequence,
                    favoritesOnly: column.friendScope.kind === 'favorites',
                    maxRows
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
        },
        [
            column.feedTypes,
            column.friendScope.kind,
            currentUserId,
            excludedFavoriteUserIds,
            favoriteUserIds
        ]
    );

    const prepareFeedColumnRowsForCommit = useCallback(
        async ({
            requestIsCurrent,
            result
        }: {
            requestIsCurrent(): boolean;
            result: FeedReadModelResult<FeedRow>;
        }) => {
            let nextResult = result;
            while (requestIsCurrent()) {
                liveMergeRequestIdRef.current += 1;
                if (
                    useFeedLiveStore.getState().version <=
                    nextResult.maxSequence
                ) {
                    return nextResult;
                }
                const mergedResult = await mergeWithLiveRows({
                    minLiveSequence: nextResult.maxSequence,
                    requestIsCurrent,
                    rows: nextResult.rows
                });
                if (!mergedResult) {
                    return null;
                }
                nextResult = mergedResult;
            }
            return null;
        },
        [mergeWithLiveRows]
    );

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        liveMergeRequestIdRef.current += 1;
        cursorRef.current = null;
        liveSequenceRef.current = 0;
        setRows([]);
        setHasMore(true);

        if (!normalizeId(currentUserId) || !favoritesReady) {
            setLoadStatus('idle');
            return;
        }
        if (!scopeHasRows) {
            setLoadStatus('ready');
            setHasMore(false);
            return;
        }

        setLoadStatus('running');
        const liveFeedSequenceAtRequestStart =
            resolveFeedColumnInitialLiveSequence(
                useFeedLiveStore.getState().version
            );
        liveSequenceRef.current = liveFeedSequenceAtRequestStart;
        const requestIsCurrent = () => requestIdRef.current === requestId;

        feedRepository
            .queryFeedReadModel({
                userId: currentUserId,
                filters: column.feedTypes,
                excludedFavoriteUserIds,
                favoriteUserIds,
                liveEntries: [],
                minLiveSequence: liveFeedSequenceAtRequestStart,
                favoritesOnly: column.friendScope.kind === 'favorites',
                maxRows: FEED_COLUMN_PAGE_SIZE
            })
            .then(async (readModel) => {
                if (!requestIsCurrent()) {
                    return;
                }
                const pageRows = readModel.rows;
                cursorRef.current = resolveLastFeedCursor(pageRows);
                setHasMore(pageRows.length >= FEED_COLUMN_PAGE_SIZE);
                const merged = await mergeWithLiveRows({
                    minLiveSequence: readModel.maxSequence,
                    requestIsCurrent,
                    rows: pageRows
                });
                if (!merged) {
                    return;
                }
                const commitResult = await prepareFeedColumnRowsForCommit({
                    requestIsCurrent,
                    result: merged
                });
                if (!commitResult) {
                    return;
                }
                liveSequenceRef.current = Math.max(
                    commitResult.maxSequence,
                    liveFeedSequenceAtRequestStart
                );
                rowsRef.current = commitResult.rows;
                setRows(commitResult.rows);
                setLoadStatus('ready');
            })
            .catch(() => {
                if (requestIsCurrent()) {
                    setLoadStatus('error');
                    setHasMore(false);
                }
            });
    }, [
        column.feedTypes,
        currentUserId,
        excludedFavoriteUserIds,
        favoriteUserIds,
        favoritesReady,
        mergeWithLiveRows,
        prepareFeedColumnRowsForCommit,
        queryKey,
        scopeHasRows
    ]);

    useEffect(() => {
        liveMergeRequestIdRef.current += 1;
        if (loadStatus !== 'ready' || !normalizeId(currentUserId)) {
            return undefined;
        }
        return useFeedLiveStore.subscribe((state, previousState) => {
            if (
                state.version === previousState?.version ||
                state.entries.length === 0 ||
                state.version <= liveSequenceRef.current
            ) {
                return;
            }
            const requestId = requestIdRef.current;
            const mergeRequestId = liveMergeRequestIdRef.current + 1;
            liveMergeRequestIdRef.current = mergeRequestId;
            const requestIsCurrent = () =>
                requestIdRef.current === requestId &&
                liveMergeRequestIdRef.current === mergeRequestId;
            mergeWithLiveRows({
                minLiveSequence: liveSequenceRef.current,
                requestIsCurrent,
                rows: rowsRef.current
            })
                .then((merged) => {
                    if (!merged) {
                        return;
                    }
                    if (!requestIsCurrent()) {
                        return;
                    }
                    if (merged.maxSequence > liveSequenceRef.current) {
                        liveSequenceRef.current = merged.maxSequence;
                    }
                    rowsRef.current = merged.rows;
                    setRows(merged.rows);
                })
                .catch((error: unknown) => {
                    console.error(error);
                });
        });
    }, [currentUserId, loadStatus, mergeWithLiveRows]);

    const loadOlder = useCallback(() => {
        const cursor = cursorRef.current;
        if (
            loadingOlder ||
            loadStatus !== 'ready' ||
            !hasMore ||
            !cursor ||
            !normalizeId(currentUserId)
        ) {
            return;
        }
        const requestId = requestIdRef.current;
        setLoadingOlder(true);
        feedRepository
            .queryFeedPage({
                userId: currentUserId,
                filters: column.feedTypes,
                excludedFavoriteUserIds,
                favoriteUserIds,
                maxEntries: FEED_COLUMN_PAGE_SIZE,
                cursor
            })
            .then((dbRows) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                const pageRows: FeedRow[] = Array.isArray(dbRows) ? dbRows : [];
                cursorRef.current = resolveLastFeedCursor(pageRows);
                setHasMore(pageRows.length >= FEED_COLUMN_PAGE_SIZE);
                setRows((currentRows) => {
                    const nextRows = appendUniqueRows(currentRows, pageRows);
                    rowsRef.current = nextRows;
                    return nextRows;
                });
            })
            .catch(() => {
                if (requestIdRef.current === requestId) {
                    setHasMore(false);
                }
            })
            .finally(() => {
                if (requestIdRef.current === requestId) {
                    setLoadingOlder(false);
                }
            });
    }, [
        column.feedTypes,
        currentUserId,
        excludedFavoriteUserIds,
        favoriteUserIds,
        hasMore,
        loadingOlder,
        loadStatus
    ]);

    return {
        hasMore,
        loadOlder,
        loadingOlder,
        loadStatus,
        rows
    };
}
