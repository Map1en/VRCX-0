import { normalizeString } from '@/shared/utils/string';

import type { PlayerListRow } from './playerListTypes';

export type PlayerListFilterScope =
    | 'all'
    | 'friend'
    | 'favorite'
    | 'restricted';

export type PlayerListFilterableRow = Pick<
    PlayerListRow,
    | 'displayName'
    | 'isAvatarInteractionDisabled'
    | 'isBlocked'
    | 'isChatBoxMuted'
    | 'isFavorite'
    | 'isFriend'
    | 'isMuted'
    | 'note'
    | 'timeoutTime'
    | 'userId'
>;

export type PlayerListScopeCounts = Record<PlayerListFilterScope, number>;

function normalizedSearchText(value: unknown): string {
    return normalizeString(value).normalize('NFKC').toLowerCase();
}

function isRestrictedPlayer(row: PlayerListFilterableRow): boolean {
    return Boolean(
        row.isBlocked ||
        row.isMuted ||
        row.isAvatarInteractionDisabled ||
        row.isChatBoxMuted ||
        row.timeoutTime > 0
    );
}

function matchesScope(
    row: PlayerListFilterableRow,
    scope: PlayerListFilterScope
): boolean {
    switch (scope) {
        case 'friend':
            return row.isFriend;
        case 'favorite':
            return row.isFavorite;
        case 'restricted':
            return isRestrictedPlayer(row);
        case 'all':
            return true;
    }
}

export function filterPlayerListRows<T extends PlayerListFilterableRow>(
    rows: readonly T[],
    query: string,
    scope: PlayerListFilterScope
): T[] {
    const normalizedQuery = normalizedSearchText(query);

    return rows.filter((row) => {
        if (!matchesScope(row, scope)) {
            return false;
        }
        if (!normalizedQuery) {
            return true;
        }

        return [row.displayName, row.userId, row.note].some((value) =>
            normalizedSearchText(value).includes(normalizedQuery)
        );
    });
}

export function countPlayerListScopes(
    rows: readonly PlayerListFilterableRow[]
): PlayerListScopeCounts {
    return rows.reduce<PlayerListScopeCounts>(
        (counts, row) => {
            counts.all += 1;
            if (row.isFriend) {
                counts.friend += 1;
            }
            if (row.isFavorite) {
                counts.favorite += 1;
            }
            if (isRestrictedPlayer(row)) {
                counts.restricted += 1;
            }
            return counts;
        },
        { all: 0, friend: 0, favorite: 0, restricted: 0 }
    );
}
