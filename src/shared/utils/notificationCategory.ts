type NotificationCategory = 'friend' | 'group' | 'other';
type NotificationLike = {
    created_at?: string | number | null;
    createdAt?: string | number | null;
};

const FRIEND_TYPES = new Set<string>([
    'friendRequest',
    'ignoredFriendRequest',
    'invite',
    'requestInvite',
    'inviteResponse',
    'requestInviteResponse',
    'boop'
]);
const GROUP_TYPES_PREFIX = ['group.', 'moderation.'];
const GROUP_EXACT_TYPES = new Set<string>([
    'groupChange',
    'event.announcement'
]);

/**
 * Determine the category of a notification type.
 * @param {string} type
 * @returns {'friend'|'group'|'other'}
 */
function getNotificationCategory(type: string): NotificationCategory {
    if (!type) return 'other';
    if (FRIEND_TYPES.has(type)) return 'friend';
    if (
        GROUP_EXACT_TYPES.has(type) ||
        GROUP_TYPES_PREFIX.some((prefix) => type.startsWith(prefix))
    )
        return 'group';
    return 'other';
}

/**
 * Extract a millisecond timestamp from a notification object.
 * @param {object} n - A notification with created_at or createdAt field
 * @returns {number}
 */
function getNotificationTs(n: NotificationLike): number {
    const raw = n.created_at ?? n.createdAt;
    if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
    if (raw === null || raw === undefined || raw === '') return 0;
    const ts = Date.parse(String(raw));
    return Number.isFinite(ts) ? ts : 0;
}

export { getNotificationCategory, getNotificationTs };
