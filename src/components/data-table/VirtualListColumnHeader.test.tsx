// @vitest-environment jsdom

import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type AppColumnDef, useAppTable } from './appTable';
import { VirtualListColumnHeader } from './VirtualListColumnHeader';

type Row = { id: string };

const columns: AppColumnDef<Row>[] = [
    {
        id: 'spacer',
        enableHiding: false,
        enableResizing: false,
        meta: { label: '' }
    },
    { id: 'date', meta: { label: 'Date' } },
    { id: 'user', meta: { label: 'User' } }
];

function renderHeader(columnOrderLocked: boolean) {
    const { result } = renderHook(() =>
        useAppTable({
            data: [],
            columns,
            enableColumnResizing: true,
            meta: { columnOrderLocked }
        })
    );
    return render(
        <VirtualListColumnHeader
            layout={{ gridTemplateColumns: '40px 1fr 1fr' }}
            table={result.current}
        />
    );
}

describe('VirtualListColumnHeader', () => {
    afterEach(cleanup);

    it('offers a drag handle beside each labelled column header', () => {
        renderHeader(false);

        expect(screen.getByText('Date')).toBeTruthy();
        expect(screen.getByText('User')).toBeTruthy();
        expect(
            screen.getAllByRole('button', {
                name: 'accessibility.reorder_column'
            })
        ).toHaveLength(2);
    });

    it('hides the drag handles while the column order is locked', () => {
        renderHeader(true);

        expect(screen.getByText('Date')).toBeTruthy();
        expect(
            screen.queryByRole('button', {
                name: 'accessibility.reorder_column'
            })
        ).toBeNull();
    });
});
