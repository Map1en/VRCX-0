// @vitest-environment jsdom

import type {
    ColumnOrderState,
    ColumnSizingState,
    SortingState
} from '@tanstack/react-table';
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Table } from '@/ui/shadcn/table';

import { useAppTable, type AppColumnDef } from './appTable';
import {
    DataTableColumnDndProvider,
    DataTableHeader,
    getDataTableSizingStyle
} from './DataTableView';

type Row = { name: string; count: number; note: string };

const columns: AppColumnDef<Row>[] = [
    {
        id: 'name',
        accessorKey: 'name',
        size: 120,
        meta: { label: 'Name' },
        header: 'Name'
    },
    {
        id: 'count',
        accessorKey: 'count',
        size: 80,
        meta: { label: 'Count' },
        header: 'Count'
    },
    {
        id: 'note',
        accessorKey: 'note',
        size: 200,
        enableSorting: false,
        meta: { label: 'Note' },
        header: 'Note'
    }
];

const onSizingChange = vi.fn();
const frameCallbacks: FrameRequestCallback[] = [];

function flushFrames() {
    for (const callback of frameCallbacks.splice(0)) {
        callback(0);
    }
}

function headerCell(label: string) {
    const thead = document.querySelector('thead');
    if (!thead) {
        throw new Error('missing table header');
    }
    return within(thead).getByText(label);
}

function Harness({ locked = false }: { locked?: boolean }) {
    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
    const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
    const [sorting, setSorting] = useState<SortingState>([]);
    const table = useAppTable({
        data: [{ name: 'a', count: 1, note: 'n' }],
        columns,
        state: { columnSizing, columnOrder, sorting },
        enableColumnResizing: true,
        onColumnSizingChange: (updater) => {
            onSizingChange();
            setColumnSizing(updater);
        },
        onColumnOrderChange: setColumnOrder,
        onSortingChange: setSorting,
        meta: { columnOrderLocked: locked }
    });

    return (
        <DataTableColumnDndProvider table={table}>
            <Table style={getDataTableSizingStyle(table)}>
                <DataTableHeader table={table} />
            </Table>
            <output data-testid="order">
                {table
                    .getVisibleLeafColumns()
                    .map((column) => column.id)
                    .join(',')}
            </output>
            <output data-testid="sorting">{JSON.stringify(sorting)}</output>
            <output data-testid="width">
                {table.getColumn('name')?.getSize()}
            </output>
        </DataTableColumnDndProvider>
    );
}

beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
        frameCallbacks.splice(0);
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('DataTableColumnResizeHandle', () => {
    it('previews the width through a CSS variable and commits once on release', () => {
        const view = render(<Harness />);
        const handle = screen.getAllByRole('separator')[0];
        const table = view.container.querySelector('table');

        fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130 });
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160 });
        flushFrames();

        expect(onSizingChange).not.toHaveBeenCalled();
        expect(table?.style.getPropertyValue('--vrcx-0-col-name')).toBe(
            '180px'
        );

        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 160 });

        expect(onSizingChange).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('width').textContent).toBe('180');
    });

    it('restores the committed width when Escape cancels a drag', () => {
        const view = render(<Harness />);
        const handle = screen.getAllByRole('separator')[0];
        const table = view.container.querySelector('table');

        fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160 });
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 160 });

        expect(onSizingChange).not.toHaveBeenCalled();
        expect(table?.style.getPropertyValue('--vrcx-0-col-name')).toBe(
            '120px'
        );
    });

    it('resizes in 16px steps from the keyboard', () => {
        render(<Harness />);
        const handle = screen.getAllByRole('separator')[0];

        fireEvent.keyDown(handle, { key: 'ArrowRight' });
        expect(screen.getByTestId('width').textContent).toBe('136');

        fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
        expect(screen.getByTestId('width').textContent).toBe('104');
    });
});

describe('TableColumnContextMenu', () => {
    it('sorts, moves and hides the right-clicked column', async () => {
        render(<Harness />);

        fireEvent.contextMenu(headerCell('Count'));
        fireEvent.click(
            await screen.findByRole('menuitemradio', {
                name: 'table.action.sort_descending'
            })
        );
        expect(screen.getByTestId('sorting').textContent).toBe(
            JSON.stringify([{ id: 'count', desc: true }])
        );

        fireEvent.contextMenu(headerCell('Count'));
        fireEvent.click(
            await screen.findByRole('menuitem', {
                name: 'table.action.move_column_left'
            })
        );
        expect(screen.getByTestId('order').textContent).toBe('count,name,note');

        fireEvent.contextMenu(headerCell('Note'));
        expect(
            screen.queryByRole('menuitemradio', {
                name: 'table.action.sort_ascending'
            })
        ).toBeNull();
        fireEvent.click(
            await screen.findByRole('menuitem', {
                name: 'table.action.hide_column'
            })
        );
        expect(screen.getByTestId('order').textContent).toBe('count,name');
    });

    it('omits column moves while the column order is locked', async () => {
        render(<Harness locked />);

        fireEvent.contextMenu(headerCell('Count'));

        expect(
            await screen.findByRole('menuitem', {
                name: 'table.action.hide_column'
            })
        ).toBeTruthy();
        expect(
            screen.queryByRole('menuitem', {
                name: 'table.action.move_column_left'
            })
        ).toBeNull();
    });
});
