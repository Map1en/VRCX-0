import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { GroupMemberRow } from '@/domain/entities/group';
import type { RemoteTabStatus } from '@/domain/shared/types';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '@/shared/constants/pagination';

type FetchMemberPage = (
    offset: number,
    force: boolean
) => Promise<GroupMemberRow[]>;

export function groupMemberUserId(row: GroupMemberRow) {
    return row.userId || row.user?.id || '';
}

export function groupMemberRowKey(row: GroupMemberRow) {
    return groupMemberUserId(row) || row.id;
}

export function appendUniqueMemberRows(
    current: readonly GroupMemberRow[],
    incoming: readonly GroupMemberRow[]
): GroupMemberRow[] {
    const seen = new Set(current.map(groupMemberRowKey).filter(Boolean));
    const appended = incoming.filter((row) => {
        const key = groupMemberRowKey(row);
        if (!key) {
            return true;
        }
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
    return [...current, ...appended];
}

export function useGroupMemberPages(
    fetchPage: FetchMemberPage,
    loadFailedMessage: string
) {
    const [rows, setRows] = useState<GroupMemberRow[]>([]);
    const [status, setStatus] = useState<RemoteTabStatus>('');
    const [error, setError] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const fetchPageRef = useRef(fetchPage);
    const loadFailedMessageRef = useRef(loadFailedMessage);
    const requestIdRef = useRef(0);
    const offsetRef = useRef(0);
    const loadingMoreRef = useRef(false);
    useLayoutEffect(() => {
        fetchPageRef.current = fetchPage;
        loadFailedMessageRef.current = loadFailedMessage;
    });

    const reset = useCallback((nextStatus: RemoteTabStatus = '') => {
        requestIdRef.current += 1;
        offsetRef.current = 0;
        loadingMoreRef.current = false;
        setRows([]);
        setError('');
        setHasMore(false);
        setLoadingMore(false);
        setStatus(nextStatus);
    }, []);

    const loadFirstPage = useCallback(async (force: boolean) => {
        const requestId = ++requestIdRef.current;
        loadingMoreRef.current = false;
        setLoadingMore(false);
        setError('');
        setStatus('running');
        try {
            const page = await fetchPageRef.current(0, force);
            if (requestId !== requestIdRef.current) {
                return;
            }
            offsetRef.current = page.length;
            setRows(page);
            setHasMore(page.length >= VRCHAT_API_DEFAULT_PAGE_SIZE);
            setStatus('ready');
        } catch (loadError) {
            if (requestId !== requestIdRef.current) {
                return;
            }
            setRows([]);
            setHasMore(false);
            setError(
                userFacingErrorMessage(loadError, loadFailedMessageRef.current)
            );
            setStatus('error');
        }
    }, []);

    async function loadMore() {
        if (loadingMoreRef.current || !hasMore || status !== 'ready') {
            return;
        }
        const requestId = requestIdRef.current;
        const offset = offsetRef.current;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        setError('');
        try {
            const page = await fetchPageRef.current(offset, false);
            if (requestId !== requestIdRef.current) {
                return;
            }
            offsetRef.current = offset + page.length;
            setRows((current) => appendUniqueMemberRows(current, page));
            setHasMore(page.length >= VRCHAT_API_DEFAULT_PAGE_SIZE);
        } catch (loadError) {
            if (requestId === requestIdRef.current) {
                setError(
                    userFacingErrorMessage(
                        loadError,
                        loadFailedMessageRef.current
                    )
                );
            }
        } finally {
            if (requestId === requestIdRef.current) {
                loadingMoreRef.current = false;
                setLoadingMore(false);
            }
        }
    }

    async function replaceRows(fetchRows: () => Promise<GroupMemberRow[]>) {
        const requestId = requestIdRef.current;
        const next = await fetchRows();
        if (requestId === requestIdRef.current) {
            offsetRef.current = next.length;
            setRows(next);
            setHasMore(false);
        }
        return next;
    }

    function removeRow(userId: string) {
        setRows((current) => {
            const next = current.filter(
                (row) => groupMemberUserId(row) !== userId
            );
            offsetRef.current = Math.max(
                0,
                offsetRef.current - (current.length - next.length)
            );
            return next;
        });
    }

    return {
        rows,
        status,
        error,
        hasMore,
        loadingMore,
        reset,
        loadFirstPage,
        loadMore,
        replaceRows,
        removeRow
    };
}
