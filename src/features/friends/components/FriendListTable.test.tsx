// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppTable } from '@/components/data-table/appTable';

import type { FriendListRow } from '../friendListRows';
import { FriendListSelectedIdsContext } from '../friendListSelectionContext';
import { useFriendListColumns } from './FriendListColumns';
import { FriendListTable } from './FriendListTable';

const onConfirmDeleteFriend = vi.fn();
const rows: FriendListRow[] = [
    { id: 'usr_alice', displayName: 'Alice' },
    { id: 'usr_bob', displayName: 'Bob' }
];

function Harness() {
    const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(
        () => new Set()
    );
    const [deletingFriendIds] = useState<Set<string>>(() => new Set());
    const onToggleSelectedFriend = useCallback((friendId: string) => {
        setSelectedFriendIds((current) => {
            const next = new Set(current);
            if (next.has(friendId)) {
                next.delete(friendId);
            } else {
                next.add(friendId);
            }
            return next;
        });
    }, []);
    const columns = useFriendListColumns({
        bulkUnfriendMode: true,
        currentUserId: 'usr_owner',
        deletingFriendIds,
        onConfirmDeleteFriend,
        onToggleSelectedFriend,
        randomUserColours: false,
        randomUserColourStyle: 'classic'
    });
    const table = useAppTable({
        data: rows,
        columns,
        getRowId: (row) => String(row.id)
    });

    return (
        <FriendListSelectedIdsContext value={selectedFriendIds}>
            <FriendListTable
                table={table}
                pageCount={1}
                pageSizes={[20]}
                pagination={{ pageIndex: 0, pageSize: 20 }}
                filteredRowsLength={rows.length}
                friendDetail=""
                favoritesOnly={false}
                isLoading={false}
                isError={false}
                hasRows
                onResetTableLayout={vi.fn()}
                onPageSizeChange={vi.fn()}
                onOpenUser={vi.fn()}
            />
        </FriendListSelectedIdsContext>
    );
}

afterEach(cleanup);

describe('FriendListTable bulk selection', () => {
    it('updates row checkboxes from the shared selection without rebuilding rows', () => {
        render(<Harness />);
        const alice = screen.getByRole('checkbox', {
            name: 'common.actions.select Alice'
        });
        const bob = screen.getByRole('checkbox', {
            name: 'common.actions.select Bob'
        });

        fireEvent.click(alice);

        expect(alice.getAttribute('aria-checked')).toBe('true');
        expect(bob.getAttribute('aria-checked')).toBe('false');

        fireEvent.click(alice);

        expect(alice.getAttribute('aria-checked')).toBe('false');
    });
});
