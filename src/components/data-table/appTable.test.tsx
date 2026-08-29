// @vitest-environment jsdom

import type { ColumnSizingState } from '@tanstack/react-table';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { useAppTable, type AppColumnDef } from './appTable';

type Row = {
    detail: string;
};

const columns: AppColumnDef<Row>[] = [
    {
        accessorKey: 'detail',
        id: 'detail'
    }
];

describe('useAppTable', () => {
    it('applies controlled column sizing on mount and after updates', () => {
        const { result } = renderHook(() => {
            const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
                { detail: 360 }
            );
            const table = useAppTable({
                columns,
                data: [],
                state: { columnSizing },
                onColumnSizingChange: setColumnSizing
            });

            return table;
        });

        expect(result.current.getColumn('detail')?.getSize()).toBe(360);

        act(() => {
            result.current.setColumnSizing({ detail: 410 });
        });

        expect(result.current.getColumn('detail')?.getSize()).toBe(410);
    });

    it('keeps unhidable columns visible when persisted state hides them', () => {
        const pinnedColumns: AppColumnDef<Row>[] = [
            {
                accessorKey: 'detail',
                id: 'detail',
                enableHiding: false
            },
            {
                accessorKey: 'detail',
                id: 'note'
            }
        ];
        const { result } = renderHook(() =>
            useAppTable({
                columns: pinnedColumns,
                data: [],
                state: { columnVisibility: { detail: false, note: false } }
            })
        );

        expect(
            result.current.getVisibleLeafColumns().map((column) => column.id)
        ).toEqual(['detail']);
    });

    it('publishes drag resizing through the controlled state callback', () => {
        const { result } = renderHook(() => {
            const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
                { detail: 360 }
            );
            return useAppTable({
                columns,
                data: [],
                state: { columnSizing },
                onColumnSizingChange: setColumnSizing,
                columnResizeMode: 'onChange'
            });
        });
        const header = result.current.getHeaderGroups()[0]?.headers[0];

        act(() => {
            header?.getResizeHandler()(
                new MouseEvent('mousedown', { clientX: 100 })
            );
            document.dispatchEvent(
                new MouseEvent('mousemove', { clientX: 140 })
            );
            document.dispatchEvent(new MouseEvent('mouseup', { clientX: 140 }));
        });

        expect(result.current.getColumn('detail')?.getSize()).toBe(400);
    });
});
