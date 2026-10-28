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

vi.mock('./FriendLogViewParts', () => ({
    FriendLogTypeIndicator: ({ type }: { type: string }) => <span>{type}</span>,
    SortButton: () => <button>Sort</button>,
    renderUserCell: (row: FriendLogRow) => (
        <span>{row.resolvedDisplayName}</span>
    )
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
const resolveDisplayName = vi.fn((row: FriendLogRow) => row.displayName);

function Harness() {
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
            resolveDisplayName={resolveDisplayName}
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
});
