import type {
    ColumnSizingState,
    SortingState,
    ColumnVisibilityState
} from '@tanstack/react-table';

import {
    getDataTableStorageKey,
    readPersistedTableState,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';
import { isRecord } from '@/shared/utils/record';

import type {
    MyAvatarsGridDensity,
    MyAvatarsPlatformFilter,
    MyAvatarsReleaseStatusFilter
} from './myAvatarsTypes';

export const MY_AVATARS_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const MY_AVATARS_DEFAULT_SORTING = [{ id: 'updated_at', desc: true }];
export const MY_AVATARS_RELEASE_STATUS_OPTIONS = [
    'all',
    'public',
    'private'
] satisfies readonly MyAvatarsReleaseStatusFilter[];
export const MY_AVATARS_PLATFORM_OPTIONS = [
    'all',
    'pc',
    'android',
    'ios'
] satisfies readonly MyAvatarsPlatformFilter[];
export const MY_AVATARS_DEFAULT_CARD_SCALE = 0.6;
export const MY_AVATARS_GRID_DENSITY_CONFIG_KEY = 'VRCX_MyAvatarsGridDensityV2';
export const MY_AVATARS_LEGACY_GRID_DENSITY_CONFIG_KEY =
    'VRCX_MyAvatarsGridDensity';
const MY_AVATARS_DEFAULT_GRID_DENSITY = 'standard';
export const MY_AVATARS_GRID_DENSITY_OPTIONS = Object.freeze([
    {
        value: 'standard',
        labelKey: 'view.my_avatars.label.grid_density_standard'
    },
    {
        value: 'compact',
        labelKey: 'view.my_avatars.label.grid_density_compact'
    },
    {
        value: 'dense',
        labelKey: 'view.my_avatars.label.grid_density_dense'
    }
]);

export function isMyAvatarsReleaseStatusFilter(
    value: unknown
): value is MyAvatarsReleaseStatusFilter {
    return value === 'all' || value === 'public' || value === 'private';
}

export function isMyAvatarsPlatformFilter(
    value: unknown
): value is MyAvatarsPlatformFilter {
    return (
        value === 'all' ||
        value === 'pc' ||
        value === 'android' ||
        value === 'ios'
    );
}
export const MY_AVATARS_COLUMN_IDS = [
    'name',
    'platforms',
    'visibility',
    'timeSpent',
    'version',
    'pcPerf',
    'androidPerf',
    'iosPerf',
    'updated_at',
    'created_at',
    'actions'
];
export const MY_AVATARS_DEFAULT_COLUMN_VISIBILITY: Record<string, boolean> =
    Object.freeze({
        visibility: false,
        version: false,
        pcPerf: false,
        androidPerf: false,
        iosPerf: false,
        created_at: false
    });

const STORAGE_KEY = getDataTableStorageKey('my-avatars');
const COLUMN_ID_ALIASES: Record<string, string> = {
    releaseStatus: 'visibility',
    action: 'actions'
};
const GRID_DENSITY_VALUES = new Set(
    MY_AVATARS_GRID_DENSITY_OPTIONS.map((option) => option.value)
);
const LEGACY_GRID_DENSITY_ALIASES: Readonly<
    Record<string, MyAvatarsGridDensity>
> = Object.freeze({
    compact: 'standard',
    dense: 'compact',
    micro: 'dense'
});
const SORT_COLUMN_IDS = [
    'name',
    'visibility',
    'timeSpent',
    'version',
    'pcPerf',
    'androidPerf',
    'iosPerf',
    'updated_at',
    'created_at'
];

export function readPersistedMyAvatarsState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedMyAvatarsState(patch: Record<string, unknown>) {
    writePersistedTableState(STORAGE_KEY, patch);
}

export function isMyAvatarsGridDensity(
    value: string
): value is MyAvatarsGridDensity {
    return GRID_DENSITY_VALUES.has(value);
}

export function normalizeMyAvatarsColumnId(columnId: unknown) {
    const normalized = typeof columnId === 'string' ? columnId.trim() : '';
    if (!normalized) {
        return '';
    }

    return COLUMN_ID_ALIASES[normalized] || normalized;
}

export function sanitizeMyAvatarsSorting(value: unknown): SortingState {
    if (!Array.isArray(value)) {
        return MY_AVATARS_DEFAULT_SORTING;
    }

    const allowedIds = new Set(SORT_COLUMN_IDS);
    const filtered = value
        .map((entry): SortingState[number] | null =>
            isRecord(entry) &&
            typeof entry.id === 'string' &&
            typeof entry.desc === 'boolean'
                ? {
                      id: normalizeMyAvatarsColumnId(entry.id),
                      desc: entry.desc
                  }
                : null
        )
        .filter((entry): entry is SortingState[number] =>
            Boolean(entry && allowedIds.has(entry.id))
        );
    return filtered.length ? filtered : MY_AVATARS_DEFAULT_SORTING;
}

export function sanitizeMyAvatarsPageSizes(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return MY_AVATARS_DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(String(entry), 10))
                .filter(
                    (entry) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
        )
    ).sort((left, right) => left - right);

    return normalized.length ? normalized : MY_AVATARS_DEFAULT_PAGE_SIZES;
}

export function resolveMyAvatarsPageSize(
    candidate: unknown,
    pageSizes: readonly number[],
    fallback: number = MY_AVATARS_DEFAULT_PAGE_SIZES[1]
): number {
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : MY_AVATARS_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value: number) =>
        pageSizes.length
            ? pageSizes.reduce((previous, size) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(String(candidate), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return pageSizes.includes(parsed) ? parsed : nearestPageSize(parsed);
    }

    if (pageSizes.includes(fallback)) {
        return fallback;
    }

    return nearestPageSize(fallback);
}

export function sanitizeMyAvatarsGridDensity(
    value: unknown
): MyAvatarsGridDensity {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return isMyAvatarsGridDensity(normalized)
        ? normalized
        : MY_AVATARS_DEFAULT_GRID_DENSITY;
}

export function resolveMyAvatarsGridDensity({
    persistedDensity,
    legacyGridDensity,
    legacyCardScale
}: {
    persistedDensity?: string;
    legacyGridDensity?: string;
    legacyCardScale?: string;
} = {}): MyAvatarsGridDensity {
    const normalized = persistedDensity?.trim() ?? '';
    if (isMyAvatarsGridDensity(normalized)) {
        return normalized;
    }
    const normalizedLegacyDensity = legacyGridDensity?.trim() ?? '';
    if (LEGACY_GRID_DENSITY_ALIASES[normalizedLegacyDensity]) {
        return LEGACY_GRID_DENSITY_ALIASES[normalizedLegacyDensity];
    }

    const legacyScale = Number.parseFloat(legacyCardScale ?? '');
    if (!Number.isFinite(legacyScale)) {
        return MY_AVATARS_DEFAULT_GRID_DENSITY;
    }
    if (legacyScale <= 0.45) {
        return 'dense';
    }
    if (legacyScale <= 0.55) {
        return 'compact';
    }
    return MY_AVATARS_DEFAULT_GRID_DENSITY;
}

export function sanitizeMyAvatarsColumnVisibility(
    value: unknown
): ColumnVisibilityState {
    const visibility: ColumnVisibilityState = {};
    if (value && typeof value === 'object') {
        for (const [rawColumnId, rawVisible] of Object.entries(value)) {
            const columnId = normalizeMyAvatarsColumnId(rawColumnId);
            if (
                MY_AVATARS_COLUMN_IDS.includes(columnId) &&
                typeof rawVisible === 'boolean'
            ) {
                visibility[columnId] = rawVisible;
            }
        }
    }

    return visibility;
}

export function resolveMyAvatarsColumnVisibility(
    persistedState: Record<string, unknown> = {}
) {
    return {
        ...MY_AVATARS_DEFAULT_COLUMN_VISIBILITY,
        ...sanitizeMyAvatarsColumnVisibility(persistedState.columnVisibility)
    };
}

export function sanitizeMyAvatarsColumnOrder(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [...MY_AVATARS_COLUMN_IDS];
    }

    const ordered: string[] = [];
    for (const rawColumnId of value) {
        const columnId = normalizeMyAvatarsColumnId(rawColumnId);
        if (
            MY_AVATARS_COLUMN_IDS.includes(columnId) &&
            !ordered.includes(columnId)
        ) {
            ordered.push(columnId);
        }
    }

    for (const columnId of MY_AVATARS_COLUMN_IDS) {
        if (!ordered.includes(columnId)) {
            ordered.push(columnId);
        }
    }

    return ordered;
}

export function resolveMyAvatarsColumnOrder(value: unknown): string[] {
    const ordered = sanitizeMyAvatarsColumnOrder(value);
    return [
        'name',
        ...ordered.filter(
            (columnId) => columnId !== 'name' && columnId !== 'actions'
        ),
        'actions'
    ];
}

export function sanitizeMyAvatarsColumnSizing(
    value: unknown
): ColumnSizingState {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const normalizedSizing: Record<string, unknown> = {};
    for (const [rawColumnId, rawWidth] of Object.entries(value)) {
        const columnId = normalizeMyAvatarsColumnId(rawColumnId);
        if (MY_AVATARS_COLUMN_IDS.includes(columnId)) {
            normalizedSizing[columnId] = rawWidth;
        }
    }

    return sanitizeTableColumnSizing(normalizedSizing, MY_AVATARS_COLUMN_IDS);
}
