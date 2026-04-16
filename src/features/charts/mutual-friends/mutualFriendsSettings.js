export const MUTUAL_GRAPH_LAYOUT_LIMITS = {
    layoutIterations: { min: 300, max: 1500 },
    layoutSpacing: { min: 8, max: 240 },
    edgeCurvature: { min: 0, max: 0.2 },
    communitySeparation: { min: 0, max: 3 }
};

export const MUTUAL_GRAPH_LAYOUT_DEFAULTS = {
    layoutIterations: 800,
    layoutSpacing: 60,
    edgeCurvature: 0.1,
    communitySeparation: 0
};

export const MUTUAL_GRAPH_EMPTY_USER_ID = 'usr_00000000-0000-0000-0000-000000000000';
export const MUTUAL_GRAPH_PICKER_RESULT_LIMIT = 120;
export const MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY = 'VRCX_MutualGraphExcludedFriends';

export function clampMutualGraphNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

export function normalizeMutualFriendId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function isValidMutualFriendId(value) {
    const identifier = normalizeMutualFriendId(value);
    return Boolean(identifier && identifier !== MUTUAL_GRAPH_EMPTY_USER_ID);
}

export function normalizeExcludedMutualFriendIds(value) {
    return Array.isArray(value) ? value.map(normalizeMutualFriendId).filter(isValidMutualFriendId) : [];
}

export function readExcludedMutualFriendIds() {
    try {
        const value = localStorage.getItem(MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY);
        const parsed = value ? JSON.parse(value) : [];
        return normalizeExcludedMutualFriendIds(parsed);
    } catch {
        return [];
    }
}

export function writeExcludedMutualFriendIds(value) {
    try {
        localStorage.setItem(
            MUTUAL_GRAPH_EXCLUDED_FRIENDS_KEY,
            JSON.stringify(normalizeExcludedMutualFriendIds(value))
        );
    } catch {
        // localStorage may be unavailable; hidden mutual friends are optional UI state.
    }
}
