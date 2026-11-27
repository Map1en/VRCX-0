// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    renderHook,
    screen
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppTable } from '@/components/data-table/appTable';
import { getToggleableColumns } from '@/components/data-table/tableColumnLayout';

import type { FriendLogRow } from '../friendLogRows';
import { useFriendLogColumns } from './FriendLogColumns';
import { FriendLogVirtualList } from './FriendLogVirtualList';

const renderedUserCells = vi.hoisted((): string[] => []);

vi.mock('./FriendLogViewParts', () => ({
    FriendLogTypeIndicator: ({ type }: { type: string }) => <span>{type}</span>,
    SortButton: () => <button>Sort</button>,
    renderUserCell: (row: FriendLogRow) => {
        renderedUserCells.push(row.resolvedDisplayName ?? '');
        return <span>{row.resolvedDisplayName}</span>;
    }
}));

const rows: FriendLogRow[] = Array.from({ length: 160 }, (_, index) => ({
    rowId: index + 1,
    created_at: '2026-09-01T00:00:00Z',
    type: 'Friend',
    userId: `usr_${index}`,
    displayName: `Name ${index}`,
    friendNumber: 0
}));
const onDelete = vi.fn(async () => {});
const onlyUser = vi.fn();
const resolveDisplayName = vi.fn((row: FriendLogRow) => row.displayName);

function Harness({
    resolveName = resolveDisplayName
}: {
    resolveName?: (row: FriendLogRow) => string;
}) {
    const deleteAction = {
        currentUserId: 'usr_owner',
        rowsOwnerUserId: 'usr_owner',
        loadStatus: 'ready',
        deletingRowKey: '',
        handleDeleteRow: onDelete,
        shiftHeld: false
    };
    const columns = useFriendLogColumns(deleteAction);
    const table = useAppTable({ data: [], columns, enableSorting: false });
    return (
        <FriendLogVirtualList
            rows={rows}
            table={table}
            filterCommands={{ onlyUser }}
            resolveDisplayName={resolveName}
            deleteAction={deleteAction}
            resetKey="normal"
            hasMore={false}
            loadingOlder={false}
            loadOlderFailed={false}
            hasUnloadedLatest={false}
            onLoadOlder={() => {}}
            onReloadLatest={() => {}}
            onViewingLatestChange={() => {}}
        />
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    renderedUserCells.length = 0;
});

describe('Friend History virtual rows', () => {
    it('renders only the viewport rows with static headers and the original delete payload', () => {
        const view = render(<Harness />);
        const rendered = view.container.querySelectorAll(
            '[data-friend-history-row]'
        );
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(30);
        expect(screen.queryByRole('button', { name: 'Sort' })).toBeNull();
        expect(screen.getByText('table.friendLog.date')).toBeTruthy();
        expect(screen.getAllByRole('separator').length).toBeGreaterThan(0);
        fireEvent.click(
            screen.getAllByRole('button', { name: 'common.actions.delete' })[0]
        );
        expect(onDelete).toHaveBeenCalledWith(rows[0], { skipConfirm: false });
        expect(rows.every((row) => !('resolvedDisplayName' in row))).toBe(true);
    });

    it('marks every second history row for the striped table preference', () => {
        const view = render(<Harness />);
        const striped = Array.from(
            view.container.querySelectorAll('[data-friend-history-row]')
        ).map(
            (row) =>
                row.closest('[data-vrcx-0-virtual-row-even]') !== null &&
                row.hasAttribute('data-vrcx-0-list-row')
        );

        expect(striped.slice(0, 4)).toEqual([false, true, false, true]);
    });

    it('offers every data column in the column visibility menu', () => {
        const { result } = renderHook(() => {
            const columns = useFriendLogColumns({
                currentUserId: 'usr_owner',
                rowsOwnerUserId: 'usr_owner',
                loadStatus: 'ready',
                deletingRowKey: '',
                handleDeleteRow: onDelete,
                shiftHeld: false
            });
            return useAppTable({ data: [], columns });
        });

        expect(
            getToggleableColumns(result.current.getAllLeafColumns()).map(
                (column) => column.id
            )
        ).toEqual(['created_at', 'type', 'displayName', 'action']);
    });

    it('filters to the right-clicked user from the row context menu', async () => {
        const view = render(<Harness />);
        const firstRow = view.container.querySelector(
            '[data-friend-history-row]'
        );
        if (!firstRow) {
            throw new Error('missing history row');
        }

        fireEvent.contextMenu(firstRow);
        fireEvent.click(
            await screen.findByRole('menuitem', {
                name: 'table.filter_action.only_user'
            })
        );

        expect(onlyUser).toHaveBeenCalledWith('usr_0', 'Name 0');
    });

    it('re-renders only rows whose resolved name changed when the page re-renders', () => {
        const view = render(<Harness />);
        renderedUserCells.length = 0;

        view.rerender(<Harness resolveName={(row) => row.displayName} />);
        expect(renderedUserCells).toEqual([]);

        view.rerender(
            <Harness
                resolveName={(row) =>
                    row.userId === 'usr_1' ? 'Renamed' : row.displayName
                }
            />
        );
        expect(renderedUserCells).toEqual(['Renamed']);
    });
});
