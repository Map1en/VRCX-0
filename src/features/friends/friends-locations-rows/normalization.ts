import { hasWorldIdPrefix } from '@/shared/constants/vrchatIds';

import type { FriendLocationRecord, TranslationFn } from './types';

export function isRecord(value: unknown): value is FriendLocationRecord {
    return typeof value === 'object' && value !== null;
}

export function sourceFromFriend(friend: unknown): FriendLocationRecord {
    if (!isRecord(friend)) {
        return {};
    }
    return isRecord(friend.ref) ? friend.ref : friend;
}

const SENTINEL_LOCATION_VALUES = new Set([
    'offline',
    'offline:offline',
    'private',
    'private:private',
    'traveling',
    'traveling:traveling'
]);

export function normalizeFriendsLocationId(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!isRecord(value)) {
        return String(value ?? '').trim();
    }

    const tag = normalizeFriendsLocationId(
        value.tag || value.location || value.$location?.tag
    );
    if (tag) {
        return tag;
    }
    const id = normalizeFriendsLocationId(
        value.id || value.userId || value.shortCode
    );
    if (id) {
        return id;
    }
    const worldId = normalizeFriendsLocationId(
        value.worldId || value.world_id || value.$location?.worldId
    );
    const instanceId = normalizeFriendsLocationId(
        value.instanceId || value.instance_id || value.$location?.instanceId
    );
    if (worldId && instanceId) {
        return `${worldId}:${instanceId}`;
    }
    if (value.isOffline) {
        return 'offline';
    }
    if (value.isPrivate) {
        return 'private';
    }
    if (value.isTraveling) {
        return 'traveling';
    }
    return '';
}

function interpolateFallback(
    value: unknown,
    values: Record<string, unknown> = {}
) {
    return String(value ?? '').replace(/\{(\w+)\}/g, (match, key) =>
        Object.hasOwn(values, key) ? String(values[key]) : match
    );
}

export function localized(
    t: TranslationFn | null | undefined,
    key: string,
    fallback: string,
    values: Record<string, unknown> = {}
) {
    if (typeof t !== 'function') {
        return interpolateFallback(fallback, values);
    }

    return interpolateFallback(
        t(key, { defaultValue: fallback, ...values }),
        values
    );
}

export function normalizeDisplayText(value: unknown) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!isRecord(value)) {
        return String(value ?? '').trim();
    }
    return normalizeDisplayText(
        value.name ||
            value.displayName ||
            value.worldName ||
            value.groupName ||
            value.shortCode ||
            value.$location?.worldName ||
            value.$location?.groupName
    );
}

export function isSentinelLocationValue(value: unknown) {
    const normalizedValue = normalizeFriendsLocationId(value).toLowerCase();
    return SENTINEL_LOCATION_VALUES.has(normalizedValue);
}

export function resolveWorldIdCandidate(...values: unknown[]) {
    for (const value of values) {
        const normalizedValue = normalizeFriendsLocationId(value);
        if (normalizedValue && hasWorldIdPrefix(normalizedValue)) {
            return normalizedValue;
        }
    }
    return '';
}

export function isRawWorldReference(value: unknown) {
    return Boolean(resolveWorldIdCandidate(value));
}

export function resolveDisplayWorldName(...values: unknown[]) {
    for (const value of values) {
        const normalizedValue = normalizeDisplayText(value);
        if (normalizedValue && !isRawWorldReference(normalizedValue)) {
            return normalizedValue;
        }
    }
    return '';
}
