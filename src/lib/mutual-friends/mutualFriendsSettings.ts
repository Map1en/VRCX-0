import { safeJsonParse } from '@/shared/utils/json';

import type {
    MutualFriendsLayoutSettingKey,
    MutualFriendsLayoutSettings
} from './mutualFriendsTypes';

export const MUTUAL_GRAPH_LAYOUT_LIMITS: Record<
    MutualFriendsLayoutSettingKey,
    { min: number; max: number }
> = {
    layoutIterations: { min: 300, max: 1500 },
    layoutSpacing: { min: 8, max: 240 },
    edgeCurvature: { min: 0, max: 0.2 },
    communitySeparation: { min: 0, max: 3 }
};

export const MUTUAL_GRAPH_LAYOUT_DEFAULTS: MutualFriendsLayoutSettings = {
    layoutIterations: 800,
    layoutSpacing: 60,
    edgeCurvature: 0.1,
    communitySeparation: 0.5
};

export const MUTUAL_GRAPH_EMPTY_USER_ID =
    'usr_00000000-0000-0000-0000-000000000000';
export const MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY =
    'VRCX_MutualGraphExcludedFriends';
export const MUTUAL_GRAPH_AUTO_FETCH_PARAM = 'fetch';

export function clampMutualGraphNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number
) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

export function normalizeMutualFriendId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function isValidMutualFriendId(value: unknown) {
    const identifier = normalizeMutualFriendId(value);
    return Boolean(identifier && identifier !== MUTUAL_GRAPH_EMPTY_USER_ID);
}

export function normalizeExcludedMutualFriendIds(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(normalizeMutualFriendId).filter(isValidMutualFriendId)
        : [];
}

export function readExcludedMutualFriendIds() {
    return normalizeExcludedMutualFriendIds(
        safeJsonParse(localStorage.getItem(MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY))
    );
}

export function writeExcludedMutualFriendIds(value: unknown) {
    localStorage.setItem(
        MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY,
        JSON.stringify(normalizeExcludedMutualFriendIds(value))
    );
}
