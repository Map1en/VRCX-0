import { useEffect, useRef, useState } from 'react';

import type { GroupMemberRow } from '@/domain/entities/group';
import type { GroupMemberSort } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '@/shared/constants/pagination';

import { moderationRowUserId } from './groupModerationRows';

const PAGE_SIZE = VRCHAT_API_DEFAULT_PAGE_SIZE;

type GroupMembersPaginationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseGroupMembersPaginationParams {
    groupId: string;
    endpoint: string;
    enabled: boolean;
    query: string;
    sort: GroupMemberSort;
    roleId: string;
    reloadToken: number;
}

export interface UseGroupMembersPaginationResult {
    rows: GroupMemberRow[];
    status: GroupMembersPaginationStatus;
    error: string;
    hasMore: boolean;
    loadingMore: boolean;
    loadMore: () => void;
    removeRow: (userId: string) => void;
}

function fetchMembersPage({
    groupId,
    query,
    sort,
    roleId,
    offset,
    force = false
}: {
    groupId: string;
    query: string;
    sort: GroupMemberSort;
    roleId: string;
    offset: number;
    force?: boolean;
}): Promise<GroupMemberRow[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
        return groupProfileRepository.getGroupMembersSearch({
            groupId,
            query: trimmedQuery,
            n: PAGE_SIZE,
            offset
        });
    }
    return groupProfileRepository.getGroupMembers({
        groupId,
        n: PAGE_SIZE,
        offset,
        sort,
        roleId,
        force
    });
}

function dedupeAppend(
    current: GroupMemberRow[],
    nextPage: GroupMemberRow[]
): GroupMemberRow[] {
    const seen = new Set(
        current.map((row) => moderationRowUserId(row)).filter(Boolean)
    );
    const appended = nextPage.filter((row) => {
        const userId = moderationRowUserId(row);
        if (!userId) {
            return true;
        }
        if (seen.has(userId)) {
            return false;
        }
        seen.add(userId);
        return true;
    });
    return [...current, ...appended];
}

export function useGroupMembersPagination({
    groupId,
    endpoint,
    enabled,
    query,
    sort,
    roleId,
    reloadToken
}: UseGroupMembersPaginationParams): UseGroupMembersPaginationResult {
    const [rows, setRows] = useState<GroupMemberRow[]>([]);
    const [status, setStatus] = useState<GroupMembersPaginationStatus>('idle');
    const [error, setError] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const offsetRef = useRef(0);
    const requestIdRef = useRef(0);
    const loadingMoreRef = useRef(false);

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        offsetRef.current = 0;
        loadingMoreRef.current = false;
        setRows([]);
        setError('');
        setHasMore(false);
        setLoadingMore(false);

        if (!enabled || !groupId) {
            setStatus('idle');
            return;
        }

        const trimmedQuery = query.trim();
        if (trimmedQuery && trimmedQuery.length < 3) {
            setStatus('ready');
            return;
        }

        setStatus('loading');
        fetchMembersPage({
            groupId,
            query: trimmedQuery,
            sort,
            roleId,
            offset: 0,
            force: true
        })
            .then((page) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setRows(page);
                offsetRef.current = page.length;
                setHasMore(page.length === PAGE_SIZE);
                setStatus('ready');
            })
            .catch((requestError: unknown) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setStatus('error');
                setError(
                    requestError instanceof Error
                        ? requestError.message
                        : 'Failed to load group members.'
                );
                setRows([]);
                setHasMore(false);
            });
    }, [groupId, endpoint, enabled, query, sort, roleId, reloadToken]);

    function loadMore() {
        if (loadingMoreRef.current || !hasMore || status !== 'ready') {
            return;
        }
        const requestId = requestIdRef.current;
        const offset = offsetRef.current;
        loadingMoreRef.current = true;
        setLoadingMore(true);

        fetchMembersPage({
            groupId,
            query,
            sort,
            roleId,
            offset
        })
            .then((page) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setRows((current) => dedupeAppend(current, page));
                offsetRef.current = offset + page.length;
                setHasMore(page.length === PAGE_SIZE);
                loadingMoreRef.current = false;
                setLoadingMore(false);
            })
            .catch(() => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                loadingMoreRef.current = false;
                setLoadingMore(false);
                setHasMore(false);
            });
    }

    function removeRow(userId: string) {
        setRows((current) => {
            const next = current.filter(
                (row) => moderationRowUserId(row) !== userId
            );
            const removed = current.length - next.length;
            if (removed > 0) {
                offsetRef.current = Math.max(0, offsetRef.current - removed);
            }
            return next;
        });
    }

    return { rows, status, error, hasMore, loadingMore, loadMore, removeRow };
}
