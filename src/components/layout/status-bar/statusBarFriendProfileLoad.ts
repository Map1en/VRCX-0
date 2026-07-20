const VISIBLE_FRIEND_PROFILE_LOAD_STATUSES = new Set([
    'running',
    'cancelling',
    'completed',
    'cancelled'
]);

export function isFriendProfileLoadStatusVisible(status: unknown): boolean {
    return VISIBLE_FRIEND_PROFILE_LOAD_STATUSES.has(String(status || 'idle'));
}
