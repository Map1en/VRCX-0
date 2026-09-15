import { format } from 'date-fns';

import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
import { formatCsvField } from '@/shared/utils/csv';
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

export type AutoAcceptInviteRequestValue =
    | 'Off'
    | 'All Favorites'
    | 'Selected Favorites';

function getAuthSnapshot(): ReturnType<
    typeof useRuntimeStore.getState
>['auth'] {
    return useRuntimeStore.getState().auth || {};
}

export function getCurrentUserId() {
    const auth = getAuthSnapshot();
    return auth.currentUserId || auth.currentUserSnapshot?.id || '';
}

export function getEndpoint() {
    return getAuthSnapshot().currentUserEndpoint || '';
}

export function getFriendIds(orderedFriendIds: string[]) {
    const directFriends = getAuthSnapshot().currentUserSnapshot?.friends;
    if (Array.isArray(directFriends) && directFriends.length) {
        return directFriends;
    }
    return Array.isArray(orderedFriendIds) ? orderedFriendIds : [];
}

export function csvEscape(value: unknown) {
    return formatCsvField(value);
}

export function parseJsonArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter(
            (entry): entry is string => typeof entry === 'string'
        );
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter(
                  (entry): entry is string => typeof entry === 'string'
              )
            : [];
    } catch {
        return [];
    }
}

export function updateArrayValue<T>(
    values: readonly T[],
    value: T,
    checked: boolean
): T[] {
    const next = new Set(values);
    if (checked) {
        next.add(value);
    } else {
        next.delete(value);
    }
    return Array.from(next);
}

export async function getUserMemoMap() {
    const rows = await memoPersistenceRepository
        .getAllUserMemos()
        .catch((): never[] => []);
    return new Map(
        (Array.isArray(rows) ? rows : [])
            .filter((row) => typeof row?.userId === 'string' && row.userId)
            .map((row) => [row.userId, row.memo || ''] as const)
    );
}

export function normalizeAutoAcceptValue(
    value: unknown
): AutoAcceptInviteRequestValue {
    if (value === true || value === 'true' || value === 'All Favorites') {
        return 'All Favorites';
    }
    if (value === 'Selected Favorites') {
        return value;
    }
    return 'Off';
}

export function normalizeAutoAcceptMode(
    value: string
): Exclude<AutoAcceptInviteRequestValue, 'Off'> {
    return value === 'Selected Favorites'
        ? 'Selected Favorites'
        : 'All Favorites';
}

export function normalizeExportMemo(value: unknown) {
    return String(value ?? '').replace(/[\r\n]/g, ' ');
}

export function truncateExportMemo(value: unknown) {
    return normalizeExportMemo(value).slice(0, 256);
}

export function getEventGroupId(event: GroupCalendarEventRecord | null) {
    return event?.ownerId || event?.groupId || event?.group?.id || '';
}

export function getEventId(event: GroupCalendarEventRecord | null) {
    return event?.id || event?.eventId || '';
}

export function selectedDateKey(value?: Date | number | string | null) {
    return format(value || new Date(), 'yyyy-MM-dd');
}
