// @vitest-environment jsdom

import type { ColumnSizingState } from '@tanstack/react-table';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    afterEach(() => {
        cleanup();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it.each([
        {
            columnId: 'updated_at',
            values: ['2026-08-30T10:00:00Z', '2026-08-31T09:00:00Z'],
            desc: true,
            expected: ['2026-08-31T09:00:00Z', '2026-08-30T10:00:00Z']
        },
        {
            columnId: 'name',
            values: ['item2', 'item10', 'Item3'],
            desc: false,
            expected: ['Item3', 'item10', 'item2']
        },
        {
            columnId: 'count',
            values: [10, 2, 1],
            desc: false,
            expected: [1, 2, 10]
        },
        {
            columnId: 'date',
            values: [new Date('2026-08-31'), new Date('2026-08-30')],
            desc: false,
            expected: [new Date('2026-08-30'), new Date('2026-08-31')]
        }
    ])(
        'preserves $columnId ordering without unregistered sort function warnings',
        ({ columnId, values, desc, expected }) => {
            vi.stubEnv('NODE_ENV', 'development');
            const warn = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
            const data = values.map((value) => ({ value }));
            const sortColumns: AppColumnDef<(typeof data)[number]>[] = [
                { id: columnId, accessorKey: 'value' }
            ];
            const { result } = renderHook(() =>
                useAppTable({
                    columns: sortColumns,
                    defaultColumn: { size: 280 },
                    data,
                    state: { sorting: [{ id: columnId, desc }] }
                })
            );

            expect(
                result.current
                    .getRowModel()
                    .rows.map((row) => row.original.value)
            ).toEqual(expected);
            expect(warn).not.toHaveBeenCalled();
        }
    );

    it('preserves table defaults and lets column comparators override them', () => {
        const data = [{ detail: 'xx' }, { detail: 'z' }, { detail: 'aaa' }];
        const defaultColumn: Partial<AppColumnDef<Row>> = {
            size: 280,
            sortFn: (left, right) =>
                left.original.detail.length - right.original.detail.length
        };
        const { result, rerender } = renderHook(
            ({ sortColumns }) =>
                useAppTable({
                    columns: sortColumns,
                    defaultColumn,
                    data,
                    state: { sorting: [{ id: 'detail', desc: false }] }
                }),
            { initialProps: { sortColumns: columns } }
        );

        expect(result.current.getColumn('detail')?.getSize()).toBe(280);
        expect(
            result.current.getRowModel().rows.map((row) => row.original.detail)
        ).toEqual(['z', 'xx', 'aaa']);

        rerender({
            sortColumns: [
                {
                    accessorKey: 'detail',
                    id: 'detail',
                    sortFn: (left, right) =>
                        right.original.detail.length -
                        left.original.detail.length
                }
            ]
        });

        expect(result.current.getColumn('detail')?.getSize()).toBe(280);
        expect(
            result.current.getRowModel().rows.map((row) => row.original.detail)
        ).toEqual(['aaa', 'xx', 'z']);
    });

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
