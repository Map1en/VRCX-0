import { format } from 'date-fns';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import { formatCsvField } from '@/shared/utils/csv';
import { windowDelay } from '@/shared/utils/delays';
import { useRuntimeStore } from '@/state/runtimeStore';

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

export function getAuthSnapshot(): any {
    return useRuntimeStore.getState().auth || {};
}

export function getCurrentUserId() {
    const auth = getAuthSnapshot();
    return auth.currentUserId || auth.currentUserSnapshot?.id || '';
}

export function getEndpoint() {
    return getAuthSnapshot().currentUserEndpoint || '';
}

export function getFriendIds(orderedFriendIds: any) {
    const directFriends = getAuthSnapshot().currentUserSnapshot?.friends;
    if (Array.isArray(directFriends) && directFriends.length) {
        return directFriends;
    }
    return Array.isArray(orderedFriendIds) ? orderedFriendIds : [];
}

export function csvEscape(value: any) {
    return formatCsvField(value);
}

export function parseJsonArray(value: any) {
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

export function updateArrayValue(values: any, value: any, checked: any) {
    const next = new Set(Array.isArray(values) ? values : []);
    if (checked) {
        next.add(value);
    } else {
        next.delete(value);
    }
    return Array.from(next);
}

export async function getUserMemoMap() {
    const rows = await memoPersistenceRepository.getAllUserMemos().catch(() => []);
    return new Map(
        (Array.isArray(rows) ? rows : [])
            .filter((row: any) => typeof row?.userId === 'string' && row.userId)
            .map((row: any) => [row.userId, row.memo || ''])
    );
}

export function delay(ms: any) {
    return windowDelay(Number(ms) || 0);
}

export function normalizeAutoAcceptValue(value: any) {
    if (value === true || value === 'true' || value === 'All Favorites') {
        return 'All Favorites';
    }
    if (value === 'Selected Favorites') {
        return value;
    }
    return 'Off';
}

export function normalizeAutoAcceptMode(value: any) {
    return value === 'Selected Favorites'
        ? 'Selected Favorites'
        : 'All Favorites';
}

export function normalizeExportMemo(value: any) {
    return String(value ?? '').replace(/[\r\n]/g, ' ');
}

export function truncateExportMemo(value: any) {
    return normalizeExportMemo(value).slice(0, 256);
}

export function getEventGroupId(event: any) {
    return event?.ownerId || event?.groupId || event?.group?.id || '';
}

export function getEventId(event: any) {
    return event?.id || event?.eventId || '';
}

export function selectedDateKey(value: any) {
    return format(value || new Date(), 'yyyy-MM-dd');
}
