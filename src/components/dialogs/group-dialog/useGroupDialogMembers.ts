import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupMemberRow } from '@/domain/entities/group';
import type { RemoteTabStatus } from '@/domain/shared/types';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '@/shared/constants/pagination';

import {
    appendUniqueMemberRows,
    useGroupMemberPages
} from './useGroupMemberPages';

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
    const { t } = useTranslation();
    const searchFailedMessageRef = useRef('');
    searchFailedMessageRef.current = t('dialog.group.members.failed_to_search');
    const pages = useGroupMemberPages(
        (offset, force) =>
            groupProfileRepository.getGroupMembers({
                groupId,
                n: VRCHAT_API_DEFAULT_PAGE_SIZE,
                offset,
                force
            }),
        t('dialog.group.members.failed_to_load')
    );
    const { reset, loadFirstPage } = pages;
    const [staffRows, setStaffRows] = useState<GroupMemberRow[]>([]);
    const [query, setQuery] = useState('');
    const [searchRows, setSearchRows] = useState<GroupMemberRow[]>([]);
    const [searchStatus, setSearchStatus] = useState<RemoteTabStatus>('');
    const [searchError, setSearchError] = useState('');
    const loadedKeyRef = useRef('');
    const staffRequestRef = useRef(0);
    const searchRequestRef = useRef(0);
    const staffRoleKey = staffRoleIds.join('\n');
    const loadKey = `${endpoint}\n${groupId}`;

    const trimmedQuery = query.trim();
    const isSearching = trimmedQuery.length > 0;

    async function loadStaff(force: boolean) {
        const requestId = ++staffRequestRef.current;
        const roleIds = staffRoleKey ? staffRoleKey.split('\n') : [];
        if (!roleIds.length) {
            setStaffRows([]);
            return;
        }
        const staffPages = await Promise.allSettled(
            roleIds.slice(0, STAFF_ROLE_FETCH_LIMIT).map((roleId) =>
                groupProfileRepository.getGroupMembers({
                    groupId,
                    n: VRCHAT_API_DEFAULT_PAGE_SIZE,
                    offset: 0,
                    roleId,
                    force
                })
            )
        );
        if (requestId !== staffRequestRef.current) {
            return;
        }
        let merged: GroupMemberRow[] = [];
        for (const staffPage of staffPages) {
            if (staffPage.status === 'fulfilled') {
                merged = appendUniqueMemberRows(merged, staffPage.value);
            }
        }
        setStaffRows(merged);
    }

    function refresh(force: boolean) {
        loadedKeyRef.current = loadKey;
        setSearchError('');
        void loadStaff(force);
        return loadFirstPage(force);
    }

    useEffect(() => {
        reset();
        staffRequestRef.current += 1;
        searchRequestRef.current += 1;
        setStaffRows([]);
        setQuery('');
        setSearchRows([]);
        setSearchStatus('');
        setSearchError('');
    }, [endpoint, groupId, reset]);

    const loadForActiveKey = useEffectEvent(() => {
        if (!active || !groupId) {
            return;
        }
        if (loadedKeyRef.current === loadKey && pages.status !== 'error') {
            return;
        }
        void refresh(false);
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
            } catch (searchFailure) {
                if (requestId !== searchRequestRef.current) {
                    return;
                }
                setSearchRows([]);
                setSearchStatus('error');
                setSearchError(
                    userFacingErrorMessage(
                        searchFailure,
                        searchFailedMessageRef.current
                    )
                );
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [active, groupId, isSearching, trimmedQuery]);

    const loweredQuery = trimmedQuery.toLowerCase();
    const visibleRows = isSearching
        ? searchStatus === 'ready'
            ? appendUniqueMemberRows(
                  searchRows,
                  pages.rows.filter((row) =>
                      (row.user?.displayName ?? '')
                          .toLowerCase()
                          .includes(loweredQuery)
                  )
              )
            : searchRows
        : pages.status === 'ready' || pages.rows.length
          ? pages.rows
          : seedRows;

    const model: GroupDialogMembersModel = {
        rows: visibleRows,
        staffRows,
        status: pages.status,
        error: pages.error || searchError,
        loadedCount: pages.rows.length,
        totalCount,
        hasMore: !isSearching && pages.hasMore,
        isLoadingMore: pages.loadingMore,
        query,
        isSearching,
        searchStatus
    };

    return {
        model,
        setQuery,
        refresh: () => refresh(true),
        loadMore: pages.loadMore,
        loadAll: () =>
            pages.replaceRows(() =>
                groupProfileRepository.getAllGroupMembers({
                    groupId,
                    force: true
                })
            )
    };
}
