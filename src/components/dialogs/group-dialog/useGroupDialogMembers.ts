import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type { GroupMemberRow } from '@/domain/entities/group';
import type { RemoteTabStatus } from '@/domain/shared/types';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '@/shared/constants/pagination';

const SEARCH_DEBOUNCE_MS = 300;
const STAFF_ROLE_FETCH_LIMIT = 4;

export type GroupDialogMembersModel = {
    rows: GroupMemberRow[];
    staffRows: GroupMemberRow[];
    status: RemoteTabStatus;
    error: string;
    loadedCount: number;
    totalCount: number | null;
    hasMore: boolean;
    isLoadingMore: boolean;
    query: string;
    isSearching: boolean;
    searchStatus: RemoteTabStatus;
};

type LoadKey = {
    endpoint: string;
    groupId: string;
};

function sameKey(left: LoadKey, right: LoadKey) {
    return left.endpoint === right.endpoint && left.groupId === right.groupId;
}

function memberKey(row: GroupMemberRow) {
    return row.userId || row.id;
}

function mergeRows(current: GroupMemberRow[], incoming: GroupMemberRow[]) {
    const seen = new Set(current.map(memberKey));
    const next = [...current];
    for (const row of incoming) {
        const key = memberKey(row);
        if (!seen.has(key)) {
            seen.add(key);
            next.push(row);
        }
    }
    return next;
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

export function useGroupDialogMembers({
    endpoint,
    groupId,
    active,
    totalCount,
    staffRoleIds,
    seedRows
}: {
    endpoint: string;
    groupId: string;
    active: boolean;
    totalCount: number | null;
    staffRoleIds: readonly string[];
    seedRows: GroupMemberRow[];
}) {
    const [rows, setRows] = useState<GroupMemberRow[]>([]);
    const [staffRows, setStaffRows] = useState<GroupMemberRow[]>([]);
    const [status, setStatus] = useState<RemoteTabStatus>('');
    const [error, setError] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [query, setQuery] = useState('');
    const [searchRows, setSearchRows] = useState<GroupMemberRow[]>([]);
    const [searchStatus, setSearchStatus] = useState<RemoteTabStatus>('');
    const keyRef = useRef<LoadKey>({ endpoint, groupId });
    const requestRef = useRef(0);
    const searchRequestRef = useRef(0);
    const staffRoleKey = staffRoleIds.join('\n');

    const trimmedQuery = query.trim();
    const isSearching = trimmedQuery.length > 0;

    async function fetchPage(key: LoadKey, offset: number, force: boolean) {
        return groupProfileRepository.getGroupMembers({
            groupId: key.groupId,
            n: VRCHAT_API_DEFAULT_PAGE_SIZE,
            offset,
            force
        });
    }

    async function loadStaff(key: LoadKey, requestId: number, force: boolean) {
        const roleIds = staffRoleKey ? staffRoleKey.split('\n') : [];
        if (!roleIds.length) {
            setStaffRows([]);
            return;
        }
        const pages = await Promise.allSettled(
            roleIds.slice(0, STAFF_ROLE_FETCH_LIMIT).map((roleId) =>
                groupProfileRepository.getGroupMembers({
                    groupId: key.groupId,
                    n: VRCHAT_API_DEFAULT_PAGE_SIZE,
                    offset: 0,
                    roleId,
                    force
                })
            )
        );
        if (requestId !== requestRef.current || !sameKey(key, keyRef.current)) {
            return;
        }
        let merged: GroupMemberRow[] = [];
        for (const page of pages) {
            if (page.status === 'fulfilled') {
                merged = mergeRows(merged, page.value);
            }
        }
        setStaffRows(merged);
    }

    async function loadFirstPage(force: boolean) {
        const key: LoadKey = { endpoint, groupId };
        keyRef.current = key;
        const requestId = ++requestRef.current;
        setStatus('running');
        setError('');
        void loadStaff(key, requestId, force);
        try {
            const page = await fetchPage(key, 0, force);
            if (
                requestId !== requestRef.current ||
                !sameKey(key, keyRef.current)
            ) {
                return;
            }
            setRows(page);
            setHasMore(page.length >= VRCHAT_API_DEFAULT_PAGE_SIZE);
            setStatus('ready');
        } catch (loadError) {
            if (requestId !== requestRef.current) {
                return;
            }
            setStatus('error');
            setError(errorMessage(loadError, 'Failed to load members.'));
        }
    }

    async function loadMore() {
        if (isLoadingMore || !hasMore || status !== 'ready') {
            return;
        }
        const key = keyRef.current;
        const requestId = requestRef.current;
        setIsLoadingMore(true);
        try {
            const page = await fetchPage(key, rows.length, false);
            if (
                requestId !== requestRef.current ||
                !sameKey(key, keyRef.current)
            ) {
                return;
            }
            setRows((current) => mergeRows(current, page));
            setHasMore(page.length >= VRCHAT_API_DEFAULT_PAGE_SIZE);
        } catch (loadError) {
            if (requestId !== requestRef.current) {
                return;
            }
            setError(errorMessage(loadError, 'Failed to load members.'));
        } finally {
            if (requestId === requestRef.current) {
                setIsLoadingMore(false);
            }
        }
    }

    async function loadAll() {
        const key = keyRef.current;
        const all = await groupProfileRepository.getAllGroupMembers({
            groupId: key.groupId,
            force: true
        });
        if (sameKey(key, keyRef.current)) {
            setRows(all);
            setHasMore(false);
        }
        return all;
    }

    useEffect(() => {
        requestRef.current += 1;
        searchRequestRef.current += 1;
        setRows([]);
        setStaffRows([]);
        setStatus('');
        setError('');
        setHasMore(false);
        setIsLoadingMore(false);
        setQuery('');
        setSearchRows([]);
        setSearchStatus('');
    }, [endpoint, groupId]);

    const loadForActiveKey = useEffectEvent(() => {
        if (!active || !groupId) {
            return;
        }
        const key: LoadKey = { endpoint, groupId };
        if (
            status !== '' &&
            status !== 'error' &&
            sameKey(key, keyRef.current)
        ) {
            return;
        }
        void loadFirstPage(false);
    });

    useEffect(() => {
        loadForActiveKey();
    }, [active, endpoint, groupId, staffRoleKey]);

    useEffect(() => {
        if (!active || !groupId || !isSearching) {
            searchRequestRef.current += 1;
            setSearchRows([]);
            setSearchStatus('');
            return undefined;
        }
        const requestId = ++searchRequestRef.current;
        setSearchStatus('running');
        const timer = window.setTimeout(async () => {
            try {
                const results =
                    await groupProfileRepository.getGroupMembersSearch({
                        groupId,
                        query: trimmedQuery,
                        n: VRCHAT_API_DEFAULT_PAGE_SIZE
                    });
                if (requestId !== searchRequestRef.current) {
                    return;
                }
                setSearchRows(results);
                setSearchStatus('ready');
            } catch (searchError) {
                if (requestId !== searchRequestRef.current) {
                    return;
                }
                setSearchRows([]);
                setSearchStatus('error');
                setError(
                    errorMessage(searchError, 'Failed to search members.')
                );
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [active, groupId, isSearching, trimmedQuery]);

    const visibleRows = isSearching
        ? searchRows
        : status === 'ready' || rows.length
          ? rows
          : seedRows;

    const model: GroupDialogMembersModel = {
        rows: visibleRows,
        staffRows,
        status,
        error,
        loadedCount: rows.length,
        totalCount,
        hasMore: !isSearching && hasMore,
        isLoadingMore,
        query,
        isSearching,
        searchStatus
    };

    return {
        model,
        setQuery,
        refresh: () => loadFirstPage(true),
        loadMore,
        loadAll
    };
}
