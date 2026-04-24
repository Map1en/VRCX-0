export const MY_AVATARS_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const MY_AVATARS_DEFAULT_SORTING = [{ id: 'updated_at', desc: true }];
export const MY_AVATARS_VIEW_MODES = ['grid', 'table'];
export const MY_AVATARS_RELEASE_STATUS_OPTIONS = ['all', 'public', 'private'];
export const MY_AVATARS_PLATFORM_OPTIONS = ['all', 'pc', 'android', 'ios'];
export const MY_AVATARS_DEFAULT_CARD_SCALE = 0.6;
export const MY_AVATARS_DEFAULT_CARD_SPACING = 1;
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

const STORAGE_KEY = 'vrcx:table:my-avatars';
const COLUMN_ID_ALIASES = {
    releaseStatus: 'visibility',
    action: 'actions'
};
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

function safeJsonParse(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export function readPersistedMyAvatarsState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
}

export function writePersistedMyAvatarsState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const current = readPersistedMyAvatarsState();
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                ...current,
                ...patch,
                updatedAt: Date.now()
            })
        );
    } catch {
        // Persisted table state is optional.
    }
}

export function normalizeMyAvatarsColumnId(columnId) {
    const normalized = typeof columnId === 'string' ? columnId.trim() : '';
    if (!normalized) {
        return '';
    }

    return COLUMN_ID_ALIASES[normalized] || normalized;
}

export function sanitizeMyAvatarsSorting(value) {
    if (!Array.isArray(value)) {
        return MY_AVATARS_DEFAULT_SORTING;
    }

    const allowedIds = new Set(SORT_COLUMN_IDS);
    const filtered = value
        .map((entry) =>
            entry && typeof entry.id === 'string'
                ? {
                      ...entry,
                      id: normalizeMyAvatarsColumnId(entry.id)
                  }
                : null
        )
        .filter((entry) => entry && allowedIds.has(entry.id));
    return filtered.length ? filtered : MY_AVATARS_DEFAULT_SORTING;
}

export function sanitizeMyAvatarsPageSizes(value) {
    if (!Array.isArray(value)) {
        return MY_AVATARS_DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(entry, 10))
                .filter(
                    (entry) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
        )
    ).sort((left, right) => left - right);

    return normalized.length ? normalized : MY_AVATARS_DEFAULT_PAGE_SIZES;
}

export function resolveMyAvatarsPageSize(
    candidate,
    allowed,
    fallback = MY_AVATARS_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size) => Number.isFinite(size) && size > 0)
        : MY_AVATARS_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : MY_AVATARS_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value) =>
        pageSizes.length
            ? pageSizes.reduce((previous, size) =>
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

export function sanitizeMyAvatarsCardScale(value) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
        return Math.min(1.4, Math.max(0.4, parsed));
    }
    return MY_AVATARS_DEFAULT_CARD_SCALE;
}

export function sanitizeMyAvatarsCardSpacing(value) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
        return Math.min(2, Math.max(0.6, parsed));
    }
    return MY_AVATARS_DEFAULT_CARD_SPACING;
}

export function sanitizeMyAvatarsColumnVisibility(value) {
    const visibility = {};
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

export function sanitizeMyAvatarsColumnOrder(value) {
    if (!Array.isArray(value)) {
        return [...MY_AVATARS_COLUMN_IDS];
    }

    const ordered = [];
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

export function sanitizeMyAvatarsColumnSizing(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const sizing = {};
    for (const [rawColumnId, rawWidth] of Object.entries(value)) {
        const columnId = normalizeMyAvatarsColumnId(rawColumnId);
        const width = Number.parseInt(rawWidth, 10);
        if (
            MY_AVATARS_COLUMN_IDS.includes(columnId) &&
            Number.isFinite(width) &&
            width > 0
        ) {
            sizing[columnId] = width;
        }
    }

    return sizing;
}
