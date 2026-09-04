import type { SortingState } from '@tanstack/react-table';

export const DATE_AND_TYPE_SORT_COLUMN_IDS: readonly string[] = [
    'created_at',
    'type'
];

type DateAndTypeRow = {
    rowId: number;
    created_at: string;
    type: string;
};

function compareRowDates(left: DateAndTypeRow, right: DateAndTypeRow): number {
    const leftTs = Date.parse(left.created_at);
    const rightTs = Date.parse(right.created_at);
    if (
        Number.isFinite(leftTs) &&
        Number.isFinite(rightTs) &&
        leftTs !== rightTs
    ) {
        return leftTs - rightTs;
    }

    return left.rowId - right.rowId;
}

export function sortTableRowsByDateAndType<TRow extends DateAndTypeRow>(
    rows: TRow[],
    sorting: SortingState
): TRow[] {
    const activeSorting = sorting.filter(({ id }) =>
        DATE_AND_TYPE_SORT_COLUMN_IDS.includes(id)
    );
    if (activeSorting.length === 0) {
        return rows;
    }

    return rows.slice().sort((left, right) => {
        for (const { id, desc } of activeSorting) {
            let comparison = 0;
            if (id === 'created_at') {
                comparison = compareRowDates(left, right);
            } else if (left.type !== right.type) {
                comparison = left.type > right.type ? 1 : -1;
            }
            if (comparison !== 0) {
                return desc ? -comparison : comparison;
            }
        }
        return 0;
    });
}
