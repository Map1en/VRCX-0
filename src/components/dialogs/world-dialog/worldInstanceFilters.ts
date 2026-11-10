import { isRecord } from '@/shared/utils/record';

export interface WorldInstanceFilterRow {
    id: string;
    ref?: unknown;
    users: Array<{ id?: unknown; userId?: unknown }>;
    playerCount?: unknown;
    userCount?: unknown;
    occupants?: unknown;
    capacity?: unknown;
    closedAt?: unknown;
}

export interface WorldInstanceFilter {
    categoryId: string;
    languages: string[];
    vibeIds: string[];
    withFriends: boolean;
    hideUnavailable: boolean;
}

export const EMPTY_WORLD_INSTANCE_FILTER: WorldInstanceFilter = {
    categoryId: '',
    languages: [],
    vibeIds: [],
    withFriends: false,
    hideUnavailable: false
};

function knownNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        if (value === null || value === undefined || value === '') {
            continue;
        }
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }
    return undefined;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter(
              (item): item is string => typeof item === 'string' && item !== ''
          )
        : [];
}

function instanceRef(row: WorldInstanceFilterRow) {
    return isRecord(row.ref) ? row.ref : {};
}

function instanceFacts(row: WorldInstanceFilterRow) {
    const ref = instanceRef(row);
    return {
        categoryId: typeof ref.categoryId === 'string' ? ref.categoryId : '',
        vibeIds: stringList(ref.vibeIds),
        languages: stringList(ref.languagesIso639)
    };
}

export function worldInstanceOccupancy(
    row: WorldInstanceFilterRow,
    worldCapacity?: number
) {
    const ref = instanceRef(row);
    const refWorld = isRecord(ref.world) ? ref.world : {};
    return {
        playerCount: knownNumber(
            row.playerCount,
            row.userCount,
            row.occupants,
            row.users.length
        ),
        capacity: knownNumber(
            row.capacity,
            ref.capacity,
            refWorld.capacity,
            worldCapacity
        )
    };
}

function isUnavailable(row: WorldInstanceFilterRow, worldCapacity?: number) {
    if (instanceRef(row).closedAt || row.closedAt) {
        return true;
    }
    const { playerCount, capacity } = worldInstanceOccupancy(
        row,
        worldCapacity
    );
    return Boolean(
        capacity && playerCount !== undefined && playerCount >= capacity
    );
}

export function activeWorldInstanceFilterCount(filter: WorldInstanceFilter) {
    return [
        filter.categoryId !== '',
        filter.languages.length > 0,
        filter.vibeIds.length > 0,
        filter.withFriends,
        filter.hideUnavailable
    ].filter(Boolean).length;
}

export function filterWorldInstanceRows<Row extends WorldInstanceFilterRow>(
    rows: readonly Row[],
    filter: WorldInstanceFilter,
    context: { isFriend: (userId: string) => boolean; worldCapacity?: number }
): Row[] {
    return rows.filter((row) => {
        const facts = instanceFacts(row);
        if (filter.categoryId && facts.categoryId !== filter.categoryId) {
            return false;
        }
        if (
            filter.languages.length &&
            !filter.languages.some((language) =>
                facts.languages.includes(language)
            )
        ) {
            return false;
        }
        if (!filter.vibeIds.every((vibeId) => facts.vibeIds.includes(vibeId))) {
            return false;
        }
        if (
            filter.withFriends &&
            !row.users.some((user) =>
                context.isFriend(String(user.id ?? user.userId ?? ''))
            )
        ) {
            return false;
        }
        return !(
            filter.hideUnavailable && isUnavailable(row, context.worldCapacity)
        );
    });
}

function byFrequency(values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([value]) => value);
}

export function worldInstanceFilterOptions(
    rows: readonly WorldInstanceFilterRow[]
) {
    const facts = rows.map(instanceFacts);
    return {
        categoryIds: byFrequency(
            facts.map((fact) => fact.categoryId).filter(Boolean)
        ),
        vibeIds: byFrequency(facts.flatMap((fact) => fact.vibeIds)),
        languages: byFrequency(facts.flatMap((fact) => fact.languages))
    };
}
