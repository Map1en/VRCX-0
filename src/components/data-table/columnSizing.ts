import type { RowData } from '@tanstack/react-table';
import type { CSSProperties } from 'react';

import type { AppColumn } from './appTable';

export type ColumnSizingStyle = CSSProperties & Record<`--${string}`, string>;

export type ColumnGridLayout = {
    gridTemplateColumns: string;
    minWidth: string;
};

export const COLUMN_SIZING_ROOT_ATTRIBUTE = 'data-column-sizing-root';

export function getColumnSizeVarName(columnId: string): `--${string}` {
    return `--vrcx-0-col-${columnId.replace(/[^\w-]/g, '_')}`;
}

export function getColumnSizeVar(columnId: string) {
    return `var(${getColumnSizeVarName(columnId)})`;
}

export function getColumnSizeVars<TData extends RowData>(
    columns: readonly AppColumn<TData>[]
): ColumnSizingStyle {
    const style: ColumnSizingStyle = {};
    for (const column of columns) {
        style[getColumnSizeVarName(column.id)] = `${column.getSize()}px`;
    }
    return style;
}

export function getColumnSizeSum<TData extends RowData>(
    columns: readonly AppColumn<TData>[]
) {
    if (!columns.length) {
        return '0px';
    }
    return `calc(${columns.map((column) => getColumnSizeVar(column.id)).join(' + ')})`;
}

export function getColumnGridLayout<TData extends RowData>(
    columns: readonly AppColumn<TData>[],
    stretchColumnId: string | null
): ColumnGridLayout {
    return {
        gridTemplateColumns: columns
            .map((column) =>
                column.id === stretchColumnId
                    ? `minmax(${getColumnSizeVar(column.id)}, 1fr)`
                    : getColumnSizeVar(column.id)
            )
            .join(' '),
        minWidth: getColumnSizeSum(columns)
    };
}

export function findColumnSizingRoot(element: HTMLElement) {
    return (
        element.closest<HTMLElement>(`[${COLUMN_SIZING_ROOT_ATTRIBUTE}]`) ??
        element.closest<HTMLElement>('table')
    );
}
