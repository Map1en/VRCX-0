import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import {
    compareByDisplayName,
    compareByFriendOrder,
    compareByLastActiveRef
} from '@/shared/utils/compare.js';

const DASH = '\u2014';

export function firstArray(...values) {
    return values.find((value) => Array.isArray(value)) || [];
}

export function normalizedText(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function isGroupId(value) {
    return normalizedText(value).startsWith('grp_');
}

export function firstNonGroupIdText(...values) {
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

export function isOfflineLikeValue(value) {
    const normalized = normalizedText(value).toLowerCase();
    return (
        !normalized ||
        normalized === 'offline' ||
        normalized === 'private' ||
        normalized === 'traveling'
    );
}

export function summarizeEntityRow(row, fallback = DASH) {
    if (typeof row === 'string') {
        return /^(usr|wrld|wld|avtr|grp)_/i.test(row.trim()) ? fallback : row;
    }
    if (!row || typeof row !== 'object') {
        return fallback;
    }
    const label =
        row.displayName ||
        row.name ||
        row.worldName ||
        row.groupName ||
        row.avatarName ||
        fallback;
    return row.$favoriteGroup ? `${row.$favoriteGroup}: ${label}` : label;
}

export function groupDisplayName(row, fallback = 'Group') {
    if (!row || typeof row !== 'object') {
        return fallback;
    }
    return firstNonGroupIdText(
        row.displayName,
        row.display_name,
        row.name,
        row.groupName,
        row.group_name,
        row.shortCode,
        row.group?.displayName,
        row.group?.display_name,
        row.group?.name,
        fallback
    );
}

export function filterRows(rows, query) {
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

export function sortAvatarRows(rows, sortBy) {
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

export function sortMutualFriendRows(rows, sortBy) {
    const comparers = {
        alphabetical: compareByDisplayName,
        lastActive: compareByLastActiveRef,
        friendOrder: compareByFriendOrder
    };
    const comparer = comparers[sortBy] || comparers.alphabetical;
    return [...rows].sort((left, right) => {
        const result = comparer(left, right);
        return Number.isFinite(result)
            ? result
            : compareByDisplayName(left, right);
    });
}

export function hydrateMutualFriendRows(rows, friendsById) {
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

export function worldOccupantSubtitle(row) {
    const occupants = Number(row?.occupants ?? row?.userCount ?? 0) || 0;
    return occupants > 0 ? `(${occupants})` : '';
}

export function normalizeLanguageRows(rows, tags = []) {
    const normalizedRows = firstArray(rows)
        .map((entry) => {
            if (typeof entry === 'string') {
                return { key: entry, value: entry };
            }
            return {
                key: entry?.key || entry?.id || entry?.value || '',
                value:
                    entry?.value ||
                    entry?.label ||
                    entry?.name ||
                    entry?.key ||
                    ''
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

export function formatDate(value) {
    if (!value) {
        return DASH;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

export function formatStatsDate(value) {
    return value ? formatDateFilter(value, 'long') : DASH;
}

export function formatStatsDuration(value) {
    const duration = Number(value) || 0;
    return duration > 0 ? timeToText(duration) : DASH;
}

export function normalizePreviousDisplayNames(value) {
    const rows =
        value instanceof Map
            ? Array.from(value, ([displayName, updated_at]) => ({
                  displayName,
                  updated_at
              }))
            : firstArray(value);

    return rows
        .map((entry) => {
            if (typeof entry === 'string') {
                return { displayName: entry, updated_at: '' };
            }
            return {
                displayName: normalizedText(entry?.displayName || entry?.name),
                updated_at:
                    entry?.updated_at || entry?.updatedAt || entry?.date || ''
            };
        })
        .filter((entry) => entry.displayName);
}

export function userIdForRow(row) {
    return normalizedText(row?.id || row?.userId || row?.targetUserId);
}

export function formatCountText(count, max) {
    const normalizedMax = Number(max) || 0;
    return normalizedMax ? `${count}/${normalizedMax}` : String(count);
}

export function resolveStatusStateText(profile) {
    const state = normalizedText(profile?.state);
    const status = normalizedText(profile?.status);
    if (state && status && state.toLowerCase() !== status.toLowerCase()) {
        return `${state} / ${status}`;
    }
    return state || status || '';
}

export function userTravelingTimestamp(row) {
    if (normalizedText(row?.location).toLowerCase() !== 'traveling') {
        return 0;
    }
    const value =
        row?.$travelingToTime || row?.travelingToTime || row?.traveling_to_time;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

export function userRowSubtitle(row, nowMs) {
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
    return (
        row?.statusDescription ||
        row?.status ||
        row?.stateBucket ||
        row?.state ||
        ''
    );
}

export { resolveTabValue } from './userDialogTabs.js';
