import {
    getDataTableStorageKey,
    readPersistedTableState,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

export const MY_AVATARS_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const MY_AVATARS_DEFAULT_SORTING = [{ id: 'updated_at', desc: true }];
export const MY_AVATARS_VIEW_MODES = ['grid', 'table'];
export const MY_AVATARS_RELEASE_STATUS_OPTIONS = ['all', 'public', 'private'];
export const MY_AVATARS_PLATFORM_OPTIONS = ['all', 'pc', 'android', 'ios'];
export const MY_AVATARS_DEFAULT_CARD_SCALE = 0.6;
export const MY_AVATARS_DEFAULT_CARD_SPACING = 1;
export const MY_AVATARS_GRID_DENSITY_CONFIG_KEY = 'VRCX_MyAvatarsGridDensityV2';
export const MY_AVATARS_LEGACY_GRID_DENSITY_CONFIG_KEY =
    'VRCX_MyAvatarsGridDensity';
export const MY_AVATARS_DEFAULT_GRID_DENSITY = 'standard';
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
export const MY_AVATARS_COLUMN_IDS = [
    'active',
    'thumbnail',
    'name',
    'customTags',
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
    MY_AVATARS_GRID_DENSITY_OPTIONS.map((option: any) => option.value)
);
const LEGACY_GRID_DENSITY_ALIASES: Readonly<Record<string, string>> =
    Object.freeze({
        compact: 'standard',
        dense: 'compact',
        micro: 'dense'
    });
const SORT_COLUMN_IDS = [
    'name',
    'customTags',
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

export function normalizeMyAvatarsColumnId(columnId: any) {
    const normalized = typeof columnId === 'string' ? columnId.trim() : '';
    if (!normalized) {
        return '';
    }

    return COLUMN_ID_ALIASES[normalized] || normalized;
}

export function sanitizeMyAvatarsSorting(value: any) {
    if (!Array.isArray(value)) {
        return MY_AVATARS_DEFAULT_SORTING;
    }

    const allowedIds = new Set(SORT_COLUMN_IDS);
    const filtered = value
        .map((entry: any) =>
            entry && typeof entry.id === 'string'
                ? {
                      ...entry,
                      id: normalizeMyAvatarsColumnId(entry.id)
                  }
                : null
        )
        .filter((entry: any) => entry && allowedIds.has(entry.id));
    return filtered.length ? filtered : MY_AVATARS_DEFAULT_SORTING;
}

export function sanitizeMyAvatarsPageSizes(value: any) {
    if (!Array.isArray(value)) {
        return MY_AVATARS_DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry: any) => Number.parseInt(entry, 10))
                .filter(
                    (entry: any) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
        )
    ).sort((left: any, right: any) => left - right);

    return normalized.length ? normalized : MY_AVATARS_DEFAULT_PAGE_SIZES;
}

export function resolveMyAvatarsPageSize(
    candidate: any,
    allowed: any,
    fallback: any = MY_AVATARS_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size: any) => Number.isFinite(size) && size > 0)
        : MY_AVATARS_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : MY_AVATARS_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value: any) =>
        pageSizes.length
            ? pageSizes.reduce((previous: any, size: any) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return pageSizes.includes(parsed) ? parsed : nearestPageSize(parsed);
    }

    if (pageSizes.includes(fallback)) {
        return fallback;
    }

    return nearestPageSize(Number(fallback) || fallbackPageSize);
}

export function sanitizeMyAvatarsCardScale(value: any) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
        return Math.min(1.4, Math.max(0.4, parsed));
    }
    return MY_AVATARS_DEFAULT_CARD_SCALE;
}

export function sanitizeMyAvatarsCardSpacing(value: any) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
        return Math.min(2, Math.max(0.6, parsed));
    }
    return MY_AVATARS_DEFAULT_CARD_SPACING;
}

export function sanitizeMyAvatarsGridDensity(value: any) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return GRID_DENSITY_VALUES.has(normalized)
        ? normalized
        : MY_AVATARS_DEFAULT_GRID_DENSITY;
}

export function resolveMyAvatarsGridDensity({
    persistedDensity,
    legacyGridDensity,
    legacyCardScale
}: any = {}) {
    const normalized =
        typeof persistedDensity === 'string' ? persistedDensity.trim() : '';
    if (GRID_DENSITY_VALUES.has(normalized)) {
        return normalized;
    }
    const normalizedLegacyDensity =
        typeof legacyGridDensity === 'string' ? legacyGridDensity.trim() : '';
    if (LEGACY_GRID_DENSITY_ALIASES[normalizedLegacyDensity]) {
        return LEGACY_GRID_DENSITY_ALIASES[normalizedLegacyDensity];
    }

    const legacyScale = Number.parseFloat(legacyCardScale);
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

export function sanitizeMyAvatarsColumnVisibility(value: any) {
    const visibility: Record<string, boolean> = {};
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

export function resolveMyAvatarsColumnVisibility(persistedState: any = {}) {
    return {
        ...MY_AVATARS_DEFAULT_COLUMN_VISIBILITY,
        ...sanitizeMyAvatarsColumnVisibility(persistedState.columnVisibility)
    };
}

export function sanitizeMyAvatarsColumnOrder(value: any) {
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

export function sanitizeMyAvatarsColumnSizing(value: any) {
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
