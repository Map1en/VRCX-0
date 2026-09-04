import type { SortingState } from '@tanstack/react-table';

import {
    getFeedRowCreatedAtMs,
    resolveFeedUserDisplayName,
    resolveFeedUserId
} from '@/components/feed/feedRows';
import type { FeedRow, FeedTableMeta } from '@/components/feed/feedTypes';

type FeedSortColumnId = 'created_at' | 'type' | 'displayName';
type FeedSortMeta = Pick<
    FeedTableMeta,
    'knownUsersById' | 'friendLogNamesById'
>;

export function getFeedTableSortValue(
    row: FeedRow,
    columnId: FeedSortColumnId,
    meta: FeedSortMeta
): string | number {
    switch (columnId) {
        case 'created_at':
            return getFeedRowCreatedAtMs(row);
        case 'type':
            return row.type || '';
        case 'displayName': {
            const userId = resolveFeedUserId(row);
            return resolveFeedUserDisplayName(
                row,
                meta.knownUsersById[userId],
                meta.friendLogNamesById[userId]
            );
        }
    }
}

export function sortFeedTableRows(
    rows: FeedRow[],
    sorting: SortingState,
    meta: FeedSortMeta
): FeedRow[] {
    const activeSorting = sorting.filter(
        (entry): entry is { id: FeedSortColumnId; desc: boolean } =>
            entry.id === 'created_at' ||
            entry.id === 'type' ||
            entry.id === 'displayName'
    );
    if (activeSorting.length === 0) {
        return rows;
    }

    return rows
        .map((row, index) => ({
            row,
            index,
            values: activeSorting.map(({ id }) =>
                getFeedTableSortValue(row, id, meta)
            )
        }))
        .sort((left, right) => {
            for (let index = 0; index < activeSorting.length; index++) {
                const leftValue = left.values[index];
                const rightValue = right.values[index];
                if (leftValue !== rightValue) {
                    const comparison = leftValue > rightValue ? 1 : -1;
                    return activeSorting[index].desc ? -comparison : comparison;
                }
            }
            return left.index - right.index;
        })
        .map(({ row }) => row);
}
