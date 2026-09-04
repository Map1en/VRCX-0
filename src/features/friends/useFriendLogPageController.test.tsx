// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppColumnDef } from '@/components/data-table/appTable';
import {
    commands,
    type ResolvedFriendLogName
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import friendLogHistoryRepository from '@/repositories/friendLogHistoryRepository';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import { useFriendLogColumns } from './components/FriendLogColumns';
import type { FriendLogRow } from './friendLogRows';
import { useFriendLogPageController } from './useFriendLogPageController';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFriendLogNamesResolve: vi.fn(),
        appFriendLogNamesCancel: vi.fn()
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: { getString: vi.fn(), setString: vi.fn() }
}));

vi.mock('@/repositories/friendLogHistoryRepository', () => ({
    default: { getFriendLogHistory: vi.fn(), deleteFriendLogHistory: vi.fn() }
}));

vi.mock('@/services/preferencesService', () => ({
    getTablePageSizesPreference: vi.fn(async () => [10, 15, 20, 25, 50, 100]),
    getTablePageSizePreference: vi.fn(async () => 20)
}));

vi.mock('./components/FriendLogColumns', () => ({
    useFriendLogColumns: vi.fn((): AppColumnDef<FriendLogRow>[] => [
        { accessorKey: 'created_at', id: 'created_at' },
        { accessorKey: 'type', id: 'type' },
        {
            accessorKey: 'resolvedDisplayName',
            id: 'displayName',
            enableSorting: false
        }
    ])
}));

function makeRows(count: number): FriendLogRow[] {
    return Array.from({ length: count }, (_, index) => ({
        rowId: index + 1,
        created_at: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
        type: 'Friend',
        userId: `usr_${index + 1}`,
        displayName: `Name ${index + 1}`,
        friendNumber: index + 1
    }));
}

function setOwner(currentUserId: string) {
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId, currentUserEndpoint: 'default' }
    }));
}

async function renderLoadedController() {
    const hook = renderHook(useFriendLogPageController);
    await waitFor(() => {
        expect(hook.result.current.rows.loadStatus).toBe('ready');
        expect(hook.result.current.tableState.pagination.pageSize).toBe(20);
    });
    return hook;
}

beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            }
        }
    });
    useFriendRosterStore.getState().resetRoster();
    useUserFactsStore.getState().resetUserFacts();
    usePreferencesStore.setState({
        hideUnfriends: false,
        preferencesHydrated: false
    });
    setOwner('usr_owner');
    vi.mocked(configRepository.getString).mockResolvedValue('[]');
    vi.mocked(commands.appFriendLogNamesResolve).mockResolvedValue([]);
    vi.mocked(commands.appFriendLogNamesCancel).mockResolvedValue(true);
    vi.mocked(friendLogHistoryRepository.getFriendLogHistory).mockResolvedValue(
        []
    );
    vi.mocked(
        friendLogHistoryRepository.deleteFriendLogHistory
    ).mockResolvedValue(1);
});

afterEach(() => {
    cleanup();
    useFriendRosterStore.getState().resetRoster();
    useUserFactsStore.getState().resetUserFacts();
    useRuntimeStore.getState().resetRuntimeState();
});

describe('FriendLog page data', () => {
    it('builds row models and display copies only for the current page, with full counts', async () => {
        const rows = makeRows(101);
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockResolvedValue(rows);
        const { result } = await renderLoadedController();

        expect(result.current.rows.rows).toBe(rows);
        expect(result.current.rows.orderedRows[0]).toBe(rows[100]);
        expect(rows.every((row) => !('resolvedDisplayName' in row))).toBe(true);
        expect(result.current.table.getCoreRowModel().rows).toHaveLength(20);
        expect(
            Object.keys(result.current.table.getCoreRowModel().rowsById)
        ).toHaveLength(20);
        expect(result.current.table.getRowCount()).toBe(101);
        expect(result.current.table.getPageCount()).toBe(6);
        expect(
            result.current.table.getRowModel().rows[0].original
                .resolvedDisplayName
        ).toBe('Name 101');
        expect(result.current.table.getRowModel().rows[0].id).toBe(
            'usr_owner:row:101'
        );

        act(() => result.current.table.setPageIndex(5));

        expect(result.current.table.getCoreRowModel().rows).toHaveLength(1);
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            1
        );
        expect(result.current.table.getCanNextPage()).toBe(false);
        expect(result.current.table.getCanPreviousPage()).toBe(true);
    });

    it('sorts all history before slicing and retains the page when sorting changes', async () => {
        const rows = makeRows(45).map((row) => ({
            ...row,
            type: row.rowId === 45 ? 'Unfriend' : 'Friend'
        }));
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockResolvedValue(rows);
        const { result } = await renderLoadedController();
        act(() => result.current.table.setPageIndex(1));
        act(() =>
            result.current.table.setSorting([{ id: 'created_at', desc: false }])
        );

        expect(result.current.tableState.pagination.pageIndex).toBe(1);
        expect(
            result.current.table
                .getRowModel()
                .rows.map((row) => row.original.rowId)
        ).toEqual(Array.from({ length: 20 }, (_, index) => 21 + index));

        act(() => result.current.table.setSorting([]));
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            25
        );

        act(() => {
            result.current.table.setPageIndex(0);
            result.current.table.setSorting([{ id: 'type', desc: false }]);
        });
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            44
        );
    });

    it('resolves and searches names outside the current page across lookup batches', async () => {
        const rows = makeRows(101).map((row) => ({ ...row, displayName: '' }));
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockResolvedValue(rows);
        vi.mocked(commands.appFriendLogNamesResolve).mockImplementation(
            async ({ userIds = [] }) =>
                userIds.map((userId) => ({
                    userId,
                    displayName:
                        userId === 'usr_1'
                            ? 'Target Name'
                            : `Resolved ${userId}`
                }))
        );
        const { result } = await renderLoadedController();
        await waitFor(() =>
            expect(result.current.rows.resolveDisplayName(rows[100])).toBe(
                'Resolved usr_101'
            )
        );
        const requestedIds = vi
            .mocked(commands.appFriendLogNamesResolve)
            .mock.calls.flatMap(([input]) => input.userIds);
        expect(new Set(requestedIds).size).toBe(101);
        expect(
            result.current.table
                .getRowModel()
                .rows.some((row) => row.original.rowId === 1)
        ).toBe(false);

        act(() => result.current.table.setPageIndex(2));
        act(() => result.current.filters.setSearchQuery('  TARGET name  '));

        expect(result.current.tableState.pagination.pageIndex).toBe(0);
        expect(result.current.table.getRowCount()).toBe(1);
        expect(result.current.rows.orderedRows[0]).toBe(rows[0]);
        expect(
            result.current.table.getRowModel().rows[0].original
                .resolvedDisplayName
        ).toBe('Target Name');
    });

    it('ignores unrelated roster changes but updates names needed for display and search', async () => {
        const rows = makeRows(3);
        rows[0].displayName = '';
        rows[2].displayName = '';
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockResolvedValue(rows);
        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_owner',
            friendsById: {
                usr_1: { id: 'usr_1', displayName: 'Roster Name' },
                usr_2: { id: 'usr_2', displayName: 'Current Name' },
                usr_other: { id: 'usr_other', displayName: 'Other Name' }
            }
        });
        useUserFactsStore.getState().replaceUserFacts([
            { endpoint: 'default', id: 'usr_1', displayName: 'Lower Priority' },
            { endpoint: 'default', id: 'usr_3', displayName: 'Fact Name' }
        ]);
        const { result } = await renderLoadedController();
        expect(
            result.current.table
                .getRowModel()
                .rows.map((row) => row.original.resolvedDisplayName)
        ).toEqual(['Fact Name', 'Name 2', 'Roster Name']);
        expect(commands.appFriendLogNamesResolve).not.toHaveBeenCalled();
        const orderedRows = result.current.rows.orderedRows;
        const coreRows = result.current.table.getCoreRowModel().rows;

        act(() =>
            useFriendRosterStore.getState().applyFriendPatches([
                {
                    userId: 'usr_1',
                    patch: { status: 'busy', location: 'wrld_new:123' }
                },
                { userId: 'usr_2', patch: { displayName: 'Renamed' } },
                { userId: 'usr_other', patch: { displayName: 'Other Renamed' } }
            ])
        );

        expect(result.current.rows.orderedRows).toBe(orderedRows);
        expect(result.current.table.getCoreRowModel().rows).toBe(coreRows);

        act(() => result.current.filters.setSearchQuery('New Name'));
        expect(result.current.table.getRowCount()).toBe(0);
        act(() =>
            useFriendRosterStore
                .getState()
                .applyFriendPatches([
                    { userId: 'usr_1', patch: { displayName: 'New Name' } }
                ])
        );

        expect(result.current.table.getRowCount()).toBe(1);
        expect(
            result.current.table.getRowModel().rows[0].original
                .resolvedDisplayName
        ).toBe('New Name');
    });

    it('preserves Unfriend visibility rules and resets the page on filtering', async () => {
        const rows = makeRows(45).map((row) => ({
            ...row,
            type: row.rowId <= 2 ? 'Unfriend' : 'Friend'
        }));
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockResolvedValue(rows);
        const { result } = await renderLoadedController();
        act(() => result.current.table.setPageIndex(1));
        act(() => usePreferencesStore.setState({ hideUnfriends: true }));

        expect(result.current.tableState.pagination.pageIndex).toBe(0);
        expect(result.current.table.getRowCount()).toBe(43);
        act(() => result.current.filters.setSelectedTypes(['Unfriend']));
        expect(result.current.table.getRowCount()).toBe(2);
        expect(
            result.current.table
                .getRowModel()
                .rows.every((row) => row.original.type === 'Unfriend')
        ).toBe(true);
    });

    it('deletes a displayed row with its original payload and clamps the last page', async () => {
        const rows = makeRows(21);
        rows[0] = {
            ...rows[0],
            type: 'DisplayName',
            previousDisplayName: 'Previous'
        };
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockResolvedValue(rows);
        const { result } = await renderLoadedController();
        act(() => result.current.table.setPageIndex(1));
        const displayed = result.current.table.getRowModel().rows[0].original;
        const options = vi.mocked(useFriendLogColumns).mock.lastCall?.[0];
        await act(async () =>
            options?.handleDeleteRow(displayed, { skipConfirm: true })
        );

        expect(
            friendLogHistoryRepository.deleteFriendLogHistory
        ).toHaveBeenCalledWith('usr_owner', expect.objectContaining(rows[0]));
        expect(result.current.table.getRowCount()).toBe(20);
        expect(result.current.tableState.pagination.pageIndex).toBe(0);
        expect(result.current.table.getRowModel().rows).toHaveLength(20);
        expect(result.current.rows.rows).not.toContain(rows[0]);
    });

    it('ignores an old account history response after an owner switch', async () => {
        let resolveOldHistory: (rows: FriendLogRow[]) => void = () => {};
        vi.mocked(friendLogHistoryRepository.getFriendLogHistory)
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveOldHistory = resolve;
                })
            )
            .mockResolvedValueOnce([
                { ...makeRows(1)[0], displayName: 'New Owner Row' }
            ]);
        const { result } = renderHook(useFriendLogPageController);
        act(() => setOwner('usr_new_owner'));
        await waitFor(() =>
            expect(result.current.rows.loadStatus).toBe('ready')
        );
        await act(async () => resolveOldHistory(makeRows(10)));

        expect(result.current.rows.rowsOwnerUserId).toBe('usr_new_owner');
        expect(result.current.table.getRowCount()).toBe(1);
        expect(result.current.table.getRowModel().rows[0].id).toBe(
            'usr_new_owner:row:1'
        );
        expect(
            result.current.table.getRowModel().rows[0].original
                .resolvedDisplayName
        ).toBe('New Owner Row');
    });

    it('cancels pending name resolution when account history is replaced', async () => {
        let resolveOldNames: (
            names: ResolvedFriendLogName[]
        ) => void = () => {};
        vi.mocked(commands.appFriendLogNamesResolve).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveOldNames = resolve;
            })
        );
        vi.mocked(friendLogHistoryRepository.getFriendLogHistory)
            .mockResolvedValueOnce([{ ...makeRows(1)[0], displayName: '' }])
            .mockResolvedValueOnce([
                { ...makeRows(1)[0], displayName: 'New Name' }
            ]);
        const { result } = await renderLoadedController();
        const request = vi.mocked(commands.appFriendLogNamesResolve).mock
            .calls[0][0];
        act(() => setOwner('usr_new_owner'));
        await waitFor(() =>
            expect(result.current.rows.loadStatus).toBe('ready')
        );
        await act(async () =>
            resolveOldNames([{ userId: 'usr_1', displayName: 'Old Name' }])
        );

        expect(commands.appFriendLogNamesCancel).toHaveBeenCalledWith(
            request.requestId
        );
        expect(
            result.current.table.getRowModel().rows[0].original
                .resolvedDisplayName
        ).toBe('New Name');
    });
});
