import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import type { FeedLiveMergeOptionsBuilder } from '../feedLiveMerge';
import {
    mergeFeedRowsWithLiveEntries,
    prepareFeedRowsForCommit
} from '../feedLiveMerge';
import { subscribeFeedLiveMerge } from '../feedLiveMergeScheduler';
import { getFeedRowId, normalizeFeedId as normalizeId } from '../feedRows';
import type { FeedLoadStatus, FeedRow } from '../feedTypes';

const FEED_COLUMN_PAGE_SIZE = 80;

export function resolveFeedColumnInitialLiveSequence(value: unknown) {
    const sequence = Number(value);
    return Number.isFinite(sequence) && sequence > 0 ? sequence : 0;
}

function resolveFeedCursor(row: FeedRow): FeedCursor | null {
    const createdAt = normalizeId(row.created_at);
    const sourceRank = row.sourceRank;
    const rowId = row.rowId;
    if (
        !createdAt ||
        typeof sourceRank !== 'number' ||
        typeof rowId !== 'number'
    ) {
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

    const buildMergeOptions = useCallback<FeedLiveMergeOptionsBuilder>(
        ({ liveEntries, minLiveSequence, rows }) => ({
            rows,
            userId: currentUserId,
            filters: column.feedTypes,
            excludedFavoriteUserIds,
            favoriteUserIds,
            liveEntries,
            minLiveSequence,
            favoritesOnly: column.friendScope.kind === 'favorites',
            maxRows: Math.max(
                rows.length + liveEntries.length,
                rows.length + FEED_COLUMN_PAGE_SIZE
            )
        }),
        [
            column.feedTypes,
            column.friendScope.kind,
            currentUserId,
            excludedFavoriteUserIds,
            favoriteUserIds
        ]
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
                const merged = await mergeFeedRowsWithLiveEntries({
                    buildMergeOptions,
                    minLiveSequence: readModel.maxSequence,
                    requestIsCurrent,
                    rows: pageRows
                });
                if (!merged) {
                    return;
                }
                const commitResult = await prepareFeedRowsForCommit({
                    buildMergeOptions,
                    onMergeRound: () => {
                        liveMergeRequestIdRef.current += 1;
                    },
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
        buildMergeOptions,
        column.feedTypes,
        currentUserId,
        excludedFavoriteUserIds,
        favoriteUserIds,
        favoritesReady,
        queryKey,
        scopeHasRows
    ]);

    useEffect(() => {
        liveMergeRequestIdRef.current += 1;
        if (loadStatus !== 'ready' || !normalizeId(currentUserId)) {
            return undefined;
        }
        return subscribeFeedLiveMerge(
            () => {
                const requestId = requestIdRef.current;
                const mergeRequestId = liveMergeRequestIdRef.current + 1;
                liveMergeRequestIdRef.current = mergeRequestId;
                const requestIsCurrent = () =>
                    requestIdRef.current === requestId &&
                    liveMergeRequestIdRef.current === mergeRequestId;
                mergeFeedRowsWithLiveEntries({
                    buildMergeOptions,
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
            },
            (state) => state.version > liveSequenceRef.current
        );
    }, [buildMergeOptions, currentUserId, loadStatus]);

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
            .then((pageRows) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
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
