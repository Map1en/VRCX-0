import dayjs from '@/lib/dayjs.js';
import { memoRepository } from '@/repositories/index.js';
import { formatCsvField } from '@/shared/utils/csv.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

export const statusOptions = ['join me', 'active', 'ask me', 'busy'];

export const instanceTypes = [
    'invite',
    'invite+',
    'friends',
    'friends+',
    'public',
    'groupPublic',
    'groupPlus',
    'groupOnly'
];

export function getAuthSnapshot() {
    return useRuntimeStore.getState().auth || {};
}

export function getCurrentUserId() {
    const auth = getAuthSnapshot();
    return auth.currentUserId || auth.currentUserSnapshot?.id || '';
}

export function getEndpoint() {
    return getAuthSnapshot().currentUserEndpoint || '';
}

export function getFriendIds(orderedFriendIds) {
    const directFriends = getAuthSnapshot().currentUserSnapshot?.friends;
    if (Array.isArray(directFriends) && directFriends.length) {
        return directFriends;
    }
    return Array.isArray(orderedFriendIds) ? orderedFriendIds : [];
}

export function csvEscape(value) {
    return formatCsvField(value);
}

export function parseJsonArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function updateArrayValue(values, value, checked) {
    const next = new Set(Array.isArray(values) ? values : []);
    if (checked) {
        next.add(value);
    } else {
        next.delete(value);
    }
    return Array.from(next);
}

export async function getUserMemoMap() {
    const rows = await memoRepository.getAllUserMemos().catch(() => []);
    return new Map(
        (Array.isArray(rows) ? rows : [])
            .filter((row) => typeof row?.userId === 'string' && row.userId)
            .map((row) => [row.userId, row.memo || ''])
    );
}

export function delay(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

export function normalizeAutoAcceptValue(value) {
    if (value === 'Selected Favorites' || value === 'All Favorites') {
        return value;
    }
    return 'Off';
}

export function normalizeAutoAcceptMode(value) {
    return value === 'Selected Favorites'
        ? 'Selected Favorites'
        : 'All Favorites';
}

export function normalizeExportMemo(value) {
    return String(value ?? '').replace(/[\r\n]/g, ' ');
}

export function truncateExportMemo(value) {
    return normalizeExportMemo(value).slice(0, 256);
}

export function getEventGroupId(event) {
    return event?.ownerId || event?.groupId || event?.group?.id || '';
}

export function getEventId(event) {
    return event?.id || event?.eventId || '';
}

export function selectedDateKey(value) {
    return dayjs(value || new Date()).format('YYYY-MM-DD');
}
