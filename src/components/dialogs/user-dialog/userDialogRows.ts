import { formatDateFilterOrFallback, timeToText } from '@/lib/dateTime';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import {
    compareByDisplayName,
    compareByFriendOrder,
    compareByLastActiveRef,
    type ComparableRecord,
    type Comparator
} from '@/shared/utils/compare';
import { userStatusLabel } from '@/shared/utils/userStatus';

const DASH = '\u2014';

type UserDialogRow = ComparableRecord & {
    authorName?: string;
    avatarName?: string;
    createdAt?: string;
    description?: string;
    display_name?: string;
    group?: Record<string, unknown>;
    groupName?: string;
    group_name?: string;
    shortCode?: string;
    statusDescription?: string;
    subtitle?: string;
    targetUserId?: string;
    travelingToTime?: unknown;
    traveling_to_time?: unknown;
    updatedAt?: string;
    userCount?: number;
    userId?: string;
    worldName?: string;
    $favoriteGroup?: string;
    $location_at?: string | number;
    $subtitle?: string;
    $travelingToTime?: unknown;
};

type LanguageRow = {
    key: string;
    value: string;
};

export type PreviousDisplayNameRow = {
    displayName: string;
    updated_at?: string;
};

export type PreviousDisplayNameSources = {
    friendLog: PreviousDisplayNameRow[];
    gameLog: PreviousDisplayNameRow[];
};

export type PreviousDisplayNameSource = keyof PreviousDisplayNameSources;

type TranslateFn = (key: string) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function firstArray(...values: unknown[]) {
    return values.find((value) => Array.isArray(value)) || [];
}

export function normalizedText(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function isGroupId(value: unknown) {
    return hasGroupIdPrefix(normalizedText(value));
}

export function firstNonGroupIdText(...values: unknown[]) {
    const fallback = [];
    for (const value of values) {
        const text = normalizedText(value);
        if (!text) {
            continue;
        }
        if (!isGroupId(text)) {
            return text;
        }
        fallback.push(text);
    }
    return fallback[0] || '';
}

export function isOfflineLikeValue(value: unknown) {
    const normalized = normalizedText(value).toLowerCase();
    return (
        !normalized ||
        normalized === 'offline' ||
        normalized === 'private' ||
        normalized === 'traveling'
    );
}

export function summarizeEntityRow(row: unknown, fallback: unknown = DASH) {
    if (typeof row === 'string') {
        return /^(usr|wrld|wld|avtr|grp)_/i.test(row.trim()) ? fallback : row;
    }
    if (!isRecord(row)) {
        return fallback;
    }
    const label =
        row.displayName ||
        row.name ||
        row.worldName ||
        row.groupName ||
        row.avatarName ||
        fallback;
    return label;
}

export function groupDisplayName(row: unknown, fallback = 'Group') {
    if (!isRecord(row)) {
        return fallback;
    }
    const group = isRecord(row.group) ? row.group : {};
    return firstNonGroupIdText(
        row.displayName,
        row.display_name,
        row.name,
        row.groupName,
        row.group_name,
        row.shortCode,
        group.displayName,
        group.display_name,
        group.name,
        fallback
    );
}

export function filterRows<T extends UserDialogRow>(rows: T[], query: unknown) {
    const normalizedQuery = String(query || '')
        .trim()
        .toLowerCase();
    if (!normalizedQuery) {
        return rows;
    }
    return rows.filter((row) =>
        [
            row?.displayName,
            row?.name,
            row?.worldName,
            row?.groupName,
            row?.avatarName,
            row?.authorName,
            row?.description,
            row?.id,
            row?.$favoriteGroup
        ].some((value) =>
            String(value || '')
                .toLowerCase()
                .includes(normalizedQuery)
        )
    );
}

export function sortAvatarRows<T extends UserDialogRow>(
    rows: readonly T[],
    sortBy: unknown
) {
    const nextRows = [...rows];
    if (sortBy === 'update') {
        return nextRows.sort((left, right) =>
            String(right.updated_at || right.updatedAt || '').localeCompare(
                String(left.updated_at || left.updatedAt || '')
            )
        );
    }
    if (sortBy === 'createdAt') {
        return nextRows.sort((left, right) =>
            String(right.created_at || right.createdAt || '').localeCompare(
                String(left.created_at || left.createdAt || '')
            )
        );
    }
    return nextRows.sort((left, right) =>
        String(left.name || '').localeCompare(String(right.name || ''))
    );
}

export function sortMutualFriendRows<T extends ComparableRecord>(
    rows: readonly T[],
    sortBy: unknown
) {
    const comparers: Record<string, Comparator> = {
        alphabetical: compareByDisplayName,
        lastActive: compareByLastActiveRef,
        friendOrder: compareByFriendOrder
    };
    const comparer =
        (typeof sortBy === 'string' ? comparers[sortBy] : undefined) ||
        comparers.alphabetical;
    return [...rows].sort((left, right) => {
        const result = comparer(left, right);
        return Number.isFinite(result)
            ? result
            : compareByDisplayName(left, right);
    });
}

export function hydrateMutualFriendRows<T extends UserDialogRow>(
    rows: readonly T[],
    friendsById: Record<string, UserDialogRow> | null | undefined
) {
    return rows.map((row) => {
        const userId = normalizedText(row?.id || row?.userId);
        const cachedFriend = userId ? friendsById?.[userId] : null;
        if (!cachedFriend) {
            return row;
        }
        const friendNumber =
            row?.$friendNumber ??
            row?.friendNumber ??
            cachedFriend.$friendNumber ??
            cachedFriend.friendNumber;
        return {
            ...cachedFriend,
            ...row,
            ...(friendNumber !== undefined
                ? { $friendNumber: friendNumber, friendNumber }
                : {})
        };
    });
}

export function worldOccupantSubtitle(row: UserDialogRow) {
    const occupants = Number(row?.occupants ?? row?.userCount ?? 0) || 0;
    return occupants > 0 ? `(${occupants})` : '';
}

export function normalizeLanguageRows(rows: unknown, tags: unknown[] = []) {
    const normalizedRows = firstArray(rows)
        .map((entry): LanguageRow => {
            if (typeof entry === 'string') {
                return { key: entry, value: entry };
            }
            const record = isRecord(entry) ? entry : {};
            return {
                key: normalizedText(record.key || record.id || record.value),
                value:
                    normalizedText(
                        record.value || record.label || record.name
                    ) || normalizedText(record.key)
            };
        })
        .filter((entry) => entry.key || entry.value);
    const seen = new Set(
        normalizedRows.map((entry) =>
            String(entry.key || entry.value).toLowerCase()
        )
    );
    for (const tag of firstArray(tags)) {
        const normalizedTag = String(tag || '')
            .trim()
            .toLowerCase();
        if (!normalizedTag.startsWith('language_')) {
            continue;
        }
        const key = normalizedTag.replace(/^language_/, '');
        if (!key || seen.has(key)) {
            continue;
        }
        normalizedRows.push({ key, value: key });
        seen.add(key);
    }
    return normalizedRows;
}

export function formatStatsDate(value: unknown) {
    return formatDateFilterOrFallback(value, 'long', { empty: DASH });
}

export function formatStatsDuration(value: unknown) {
    const duration = Number(value) || 0;
    return duration > 0 ? timeToText(duration) : DASH;
}

export function normalizePreviousDisplayNames(value: unknown) {
    const rows =
        value instanceof Map
            ? Array.from(value, ([displayName, updated_at]) => ({
                  displayName,
                  updated_at
              }))
            : firstArray(value);

    return rows
        .map((entry): PreviousDisplayNameRow => {
            if (typeof entry === 'string') {
                return { displayName: entry, updated_at: '' };
            }
            const record = isRecord(entry) ? entry : {};
            return {
                displayName: normalizedText(record.displayName || record.name),
                updated_at: normalizedText(
                    record.updated_at || record.updatedAt || record.date || ''
                )
            };
        })
        .filter((entry) => entry.displayName);
}

export function mergePreviousDisplayNames(
    currentDisplayName: unknown,
    ...sources: unknown[]
) {
    const currentName = normalizedText(currentDisplayName);
    const namesByDisplayName = new Map<string, PreviousDisplayNameRow>();

    for (const source of sources) {
        for (const entry of normalizePreviousDisplayNames(source)) {
            if (entry.displayName === currentName) {
                continue;
            }

            const existing = namesByDisplayName.get(entry.displayName);
            if (
                !existing ||
                normalizedText(entry.updated_at) >
                    normalizedText(existing.updated_at)
            ) {
                namesByDisplayName.set(entry.displayName, entry);
            }
        }
    }

    return Array.from(namesByDisplayName.values()).sort((left, right) =>
        normalizedText(right.updated_at).localeCompare(
            normalizedText(left.updated_at)
        )
    );
}

export function replacePreviousDisplayNameSource(
    currentDisplayName: unknown,
    currentSources: Partial<PreviousDisplayNameSources> | null | undefined,
    source: PreviousDisplayNameSource,
    rows: unknown
) {
    const previousDisplayNameSources: PreviousDisplayNameSources = {
        friendLog: normalizePreviousDisplayNames(currentSources?.friendLog),
        gameLog: normalizePreviousDisplayNames(currentSources?.gameLog),
        [source]: mergePreviousDisplayNames(currentDisplayName, rows)
    };

    return {
        previousDisplayNames: mergePreviousDisplayNames(
            currentDisplayName,
            previousDisplayNameSources.friendLog,
            previousDisplayNameSources.gameLog
        ),
        previousDisplayNameSources
    };
}

export function userIdForRow(row: UserDialogRow | null | undefined) {
    return normalizedText(row?.id || row?.userId || row?.targetUserId);
}

export function formatCountText(count: unknown, max: unknown) {
    const normalizedMax = Number(max) || 0;
    return normalizedMax ? `${count}/${normalizedMax}` : String(count);
}

export function resolveStatusStateText(
    profile: UserDialogRow | null | undefined
) {
    const state = normalizedText(profile?.state);
    const status = normalizedText(profile?.status);
    if (state && status && state.toLowerCase() !== status.toLowerCase()) {
        return `${state} / ${status}`;
    }
    return state || status || '';
}

export function userTravelingTimestamp(row: UserDialogRow) {
    if (normalizedText(row?.location).toLowerCase() !== 'traveling') {
        return 0;
    }
    const value =
        row?.$travelingToTime || row?.travelingToTime || row?.traveling_to_time;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? 0 : parsed;
}

export function userRowSubtitle(
    row: UserDialogRow,
    nowMs: unknown,
    t: TranslateFn
) {
    if (userTravelingTimestamp(row)) {
        return '';
    }
    const explicit = row?.$subtitle || row?.subtitle;
    if (explicit) {
        return explicit;
    }
    const joinedAt = normalizedText(
        row?.$location_at ||
            row?.locationAt ||
            row?.joinedAt ||
            row?.created_at ||
            row?.createdAt
    );
    const timestamp = joinedAt ? Date.parse(joinedAt) : Number.NaN;
    const normalizedNowMs = Number(nowMs);
    if (!Number.isNaN(timestamp) && Number.isFinite(normalizedNowMs)) {
        return timeToText(normalizedNowMs - timestamp);
    }
    return row?.statusDescription || userStatusLabel(row, t);
}

export { resolveTabValue } from './userDialogTabs';
