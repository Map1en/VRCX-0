import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';
import { moderationTypes } from '@/shared/constants/moderation';

export const MODERATION_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const MODERATION_DEFAULT_SORTING = [
    {
        id: 'created',
        desc: true
    }
];
export const MODERATION_COLUMN_IDS = [
    'spacer',
    'created',
    'type',
    'sourceDisplayName',
    'targetDisplayName',
    'action',
    'trailing'
];
const MODERATION_SORTING_COLUMN_IDS = MODERATION_COLUMN_IDS.filter(
    (columnId: any) =>
        columnId !== 'sourceDisplayName' && columnId !== 'targetDisplayName'
);
export const MODERATION_TYPE_FILTERS_CONFIG_KEY =
    'VRCX_playerModerationTableFilters';

const MODERATION_STORAGE_KEY = getDataTableStorageKey('moderation');
const TYPE_LABELS: Record<string, string> = {
    block: 'Block',
    unblock: 'Unblock',
    mute: 'Mute',
    unmute: 'Unmute',
    interactOn: 'Interact On',
    interactOff: 'Interact Off',
    muteChat: 'Mute Chat',
    unmuteChat: 'Unmute Chat'
};

export function readModerationPersistedState() {
    return readPersistedTableState(MODERATION_STORAGE_KEY);
}

export function writeModerationPersistedState(patch: Record<string, unknown>) {
    writePersistedTableState(MODERATION_STORAGE_KEY, patch);
}

export function resolveModerationTypeLabel(type: any, t: any) {
    const value = String(type || '');
    if (!value) {
        return '';
    }
    const key = `view.moderation.filters.${value}`;
    const label = t(key);
    return label && label !== key ? label : TYPE_LABELS[value] || value;
}

export function sanitizeModerationSorting(value: any) {
    if (!Array.isArray(value)) {
        return MODERATION_DEFAULT_SORTING;
    }
    const filtered = value.filter(
        (entry: any) =>
            entry &&
            typeof entry.id === 'string' &&
            MODERATION_SORTING_COLUMN_IDS.includes(entry.id)
    );
    return filtered.length ? filtered : MODERATION_DEFAULT_SORTING;
}

export function sanitizeModerationPageSizes(value: any) {
    if (!Array.isArray(value)) {
        return MODERATION_DEFAULT_PAGE_SIZES;
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
    return normalized.length ? normalized : MODERATION_DEFAULT_PAGE_SIZES;
}

export function sanitizeModerationColumnVisibility(value: any) {
    const visibility: Record<string, boolean> = {};
    if (!value || typeof value !== 'object') {
        return visibility;
    }
    for (const columnId of MODERATION_COLUMN_IDS) {
        if (typeof value[columnId] === 'boolean') {
            visibility[columnId] = value[columnId];
        }
    }
    return visibility;
}

export function sanitizeModerationColumnOrder(value: any) {
    if (!Array.isArray(value)) {
        return MODERATION_COLUMN_IDS;
    }
    const orderedColumns = value.filter((columnId: any) =>
        MODERATION_COLUMN_IDS.includes(columnId)
    );
    const missingColumns = MODERATION_COLUMN_IDS.filter(
        (columnId: any) => !orderedColumns.includes(columnId)
    );
    return [...orderedColumns, ...missingColumns];
}

export function sanitizeModerationColumnSizing(value: any) {
    return sanitizeTableColumnSizing(value, MODERATION_COLUMN_IDS);
}

export function resolveModerationPageSize(
    candidate: any,
    allowed: any,
    fallback: any = MODERATION_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size: any) => Number.isFinite(size) && size > 0)
        : MODERATION_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : MODERATION_DEFAULT_PAGE_SIZES[0];
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

export function normalizeModerationSelectedTypes(value: any) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(
        (entry: any) =>
            typeof entry === 'string' && moderationTypes.includes(entry)
    );
}

export function parseModerationSelectedTypes(value: any) {
    return normalizeModerationSelectedTypes(safeJsonParse(value));
}

export function matchesModerationSearch(row: any, searchQuery: any) {
    if (!searchQuery) {
        return true;
    }
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
        return true;
    }
    return (
        String(row?.sourceDisplayName ?? '')
            .toLowerCase()
            .includes(query) ||
        String(row?.targetDisplayName ?? '')
            .toLowerCase()
            .includes(query)
    );
}

export function getModerationRowKey(row: any) {
    if (row?.id) {
        return String(row.id);
    }
    return [
        row?.type || '',
        row?.sourceUserId || '',
        row?.targetUserId || '',
        row?.created || ''
    ].join(':');
}

export function isSameModerationRow(left: any, right: any) {
    if (left?.id && right?.id) {
        return left.id === right.id;
    }
    return (
        left?.type === right?.type &&
        left?.sourceUserId === right?.sourceUserId &&
        left?.targetUserId === right?.targetUserId &&
        left?.created === right?.created
    );
}
