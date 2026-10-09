import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toIsoRangeEnd, toIsoRangeStart } from '@/lib/dateRange';
import type { FriendLogHistoryCursor } from '@/platform/tauri/bindings';
import friendLogHistoryRepository from '@/repositories/friendLogHistoryRepository';
import { useFriendLogStore } from '@/state/friendLogStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { sortRows, type FriendLogRow } from './friendLogRows';
import { useFriendLogResolvedNames } from './useFriendLogResolvedNames';

const FRIEND_HISTORY_PAGE_SIZE = 80;

function cursorFor(row: FriendLogRow): FriendLogHistoryCursor {
    return { createdAt: row.created_at, rowId: row.rowId };
}

export function useFriendLogRows({
    refreshToken,
    searchQuery,
    selectedTypes,
    dateFrom,
    dateTo
}: {
    refreshToken: number;
    searchQuery: string;
    selectedTypes: string[];
    dateFrom: string;
    dateTo: string;
}) {
    const currentUserId =
        useRuntimeStore((state) => state.auth.currentUserId) ?? '';
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const hideUnfriends = usePreferencesStore((state) => state.hideUnfriends);
    const maxRows = usePreferencesStore(
        (state) => state.tableLimits.maxTableSize
    );
    const revision = useFriendLogStore((state) => state.revision);
    const [rows, setRows] = useState<FriendLogRow[]>([]);
    const [rowsOwnerUserId, setRowsOwnerUserId] = useState('');
    const rowsOwnerUserIdRef = useRef('');
    const [loadStatus, setLoadStatus] = useState<
        'idle' | 'running' | 'ready' | 'error'
    >('idle');
    const [detail, setDetail] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [loadOlderFailed, setLoadOlderFailed] = useState(false);
    const [hasUnloadedLatest, setHasUnloadedLatest] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const [liveRefreshToken, setLiveRefreshToken] = useState(0);
    const requestRef = useRef(0);
    const loadingOlderRef = useRef(false);
    const cursorRef = useRef<FriendLogHistoryCursor | null>(null);
    const windowBeforeRef = useRef<FriendLogHistoryCursor | null>(null);
    const rowsRef = useRef(rows);
    const deletedRowIdsRef = useRef(new Set<number>());
    const removeRow = useCallback((row: FriendLogRow) => {
        deletedRowIdsRef.current.add(row.rowId);
        const next = rowsRef.current.filter(
            (current) => current.rowId !== row.rowId
        );
        rowsRef.current = next;
        setRows(next);
    }, []);
    const viewingLatestRef = useRef(true);
    const previousQueryRef = useRef('');
    const [loadedQueryKey, setLoadedQueryKey] = useState('');
    const searchMode = Boolean(searchQuery.trim() || dateFrom || dateTo);
    const queryKey = JSON.stringify([
        currentUserId,
        endpoint,
        selectedTypes,
        hideUnfriends,
        searchQuery.trim(),
        dateFrom,
        dateTo
    ]);
    const normalQueryKey = JSON.stringify([queryKey, reloadToken]);
    const excludedTypes = useMemo(
        () =>
            hideUnfriends && !selectedTypes.includes('Unfriend')
                ? ['Unfriend']
                : [],
        [hideUnfriends, selectedTypes]
    );
    const queryOptions = useMemo(
        () => ({
            types: selectedTypes,
            excludedTypes,
            dateFrom: toIsoRangeStart(dateFrom),
            dateTo: toIsoRangeEnd(dateTo)
        }),
        [selectedTypes, excludedTypes, dateFrom, dateTo]
    );

    const reloadLatest = useCallback(() => {
        windowBeforeRef.current = null;
        viewingLatestRef.current = true;
        setHasUnloadedLatest(false);
        setReloadToken((token) => token + 1);
    }, []);
    const setViewingLatest = useCallback(
        (latest: boolean) => {
            viewingLatestRef.current = latest && !hasUnloadedLatest;
        },
        [hasUnloadedLatest]
    );
    const seenRevisionRef = useRef(revision);
    useEffect(() => {
        if (seenRevisionRef.current === revision) return;
        seenRevisionRef.current = revision;
        if (searchMode) setReloadToken((token) => token + 1);
        else if (viewingLatestRef.current)
            setLiveRefreshToken((token) => token + 1);
        else setHasUnloadedLatest(true);
    }, [revision, searchMode]);

    useEffect(() => {
        const requestId = ++requestRef.current;
        deletedRowIdsRef.current.clear();
        const changedQuery = previousQueryRef.current !== normalQueryKey;
        previousQueryRef.current = normalQueryKey;
        if (changedQuery) {
            setRows([]);
            rowsRef.current = [];
            windowBeforeRef.current = null;
            viewingLatestRef.current = true;
            setHasUnloadedLatest(false);
        }
        rowsOwnerUserIdRef.current = currentUserId;
        setRowsOwnerUserId(currentUserId);
        setLoadedQueryKey(queryKey);
        cursorRef.current = null;
        loadingOlderRef.current = false;
        setLoadingOlder(false);
        setLoadOlderFailed(false);
        setHasMore(false);
        setDetail('');
        if (!currentUserId) {
            setLoadStatus('idle');
            return;
        }
        setLoadStatus('running');
        const limit = Math.max(
            FRIEND_HISTORY_PAGE_SIZE,
            rowsRef.current.length
        );
        friendLogHistoryRepository
            .getFriendLogHistory(currentUserId, {
                ...queryOptions,
                ...(searchMode
                    ? {}
                    : { cursor: windowBeforeRef.current, limit })
            })
            .then((nextRows) => {
                if (requestRef.current !== requestId) return;
                const retained = deletedRowIdsRef.current.size
                    ? nextRows.filter(
                          (row) => !deletedRowIdsRef.current.has(row.rowId)
                      )
                    : nextRows;
                rowsRef.current = retained;
                setRows(retained);
                cursorRef.current = nextRows.length
                    ? cursorFor(nextRows[nextRows.length - 1])
                    : null;
                setHasMore(!searchMode && nextRows.length >= limit);
                setLoadStatus('ready');
            })
            .catch(() => {
                if (requestRef.current !== requestId) return;
                setLoadStatus('error');
            });
        return () => {
            requestRef.current += 1;
        };
    }, [
        currentUserId,
        normalQueryKey,
        queryKey,
        queryOptions,
        refreshToken,
        liveRefreshToken,
        searchMode
    ]);

    const loadOlder = useCallback(() => {
        const cursor = cursorRef.current;
        if (
            searchMode ||
            loadingOlderRef.current ||
            loadStatus !== 'ready' ||
            !hasMore ||
            !cursor ||
            !currentUserId
        )
            return;
        const requestId = requestRef.current;
        loadingOlderRef.current = true;
        setLoadingOlder(true);
        setLoadOlderFailed(false);
        friendLogHistoryRepository
            .getFriendLogHistory(currentUserId, {
                ...queryOptions,
                cursor,
                limit: FRIEND_HISTORY_PAGE_SIZE
            })
            .then((older) => {
                if (requestRef.current !== requestId) return;
                cursorRef.current = older.length
                    ? cursorFor(older[older.length - 1])
                    : null;
                setHasMore(older.length >= FRIEND_HISTORY_PAGE_SIZE);
                const seen = new Set(rowsRef.current.map((row) => row.rowId));
                const next = [
                    ...rowsRef.current,
                    ...older.filter(
                        (row) =>
                            !seen.has(row.rowId) &&
                            !deletedRowIdsRef.current.has(row.rowId)
                    )
                ];
                const limit = Math.max(
                    FRIEND_HISTORY_PAGE_SIZE,
                    Number.isFinite(maxRows)
                        ? maxRows
                        : FRIEND_HISTORY_PAGE_SIZE
                );
                const removed = next.length - limit;
                if (removed > 0) {
                    windowBeforeRef.current = cursorFor(next[removed - 1]);
                    setHasUnloadedLatest(true);
                    viewingLatestRef.current = false;
                }
                const retained = removed > 0 ? next.slice(removed) : next;
                rowsRef.current = retained;
                setRows(retained);
            })
            .catch(() => {
                if (requestRef.current === requestId) setLoadOlderFailed(true);
            })
            .finally(() => {
                if (requestRef.current === requestId) {
                    loadingOlderRef.current = false;
                    setLoadingOlder(false);
                }
            });
    }, [currentUserId, hasMore, loadStatus, maxRows, queryOptions, searchMode]);

    const visibleRows = useMemo(
        () =>
            rowsOwnerUserId === currentUserId && loadedQueryKey === queryKey
                ? rows
                : [],
        [rowsOwnerUserId, currentUserId, loadedQueryKey, queryKey, rows]
    );
    const resolveDisplayName = useFriendLogResolvedNames(
        currentUserId,
        visibleRows
    );
    const orderedRows = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const filtered = query
            ? visibleRows.filter((row) =>
                  resolveDisplayName(row).toLowerCase().includes(query)
              )
            : visibleRows;
        return searchMode ? sortRows(filtered) : filtered;
    }, [visibleRows, searchQuery, resolveDisplayName, searchMode]);

    return {
        currentUserId,
        detail,
        hideUnfriends,
        loadStatus,
        orderedRows,
        resolveDisplayName,
        rows: visibleRows,
        rowsOwnerUserId,
        rowsOwnerUserIdRef,
        setDetail,
        removeRow,
        hasMore,
        loadingOlder,
        loadOlderFailed,
        hasUnloadedLatest,
        loadOlder,
        reloadLatest,
        setViewingLatest,
        searchMode,
        normalQueryKey
    };
}
