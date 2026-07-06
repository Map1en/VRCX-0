export type NotificationLifecycleBucket = 'action' | 'activity' | 'system';

export const NOTIFICATION_LIFECYCLE_ORDER: NotificationLifecycleBucket[] = [
    'action',
    'activity',
    'system'
];

const ACTION_TYPES = new Set<string>([
    'friendRequest',
    'invite',
    'requestInvite',
    'boop',
    'group.invite',
    'group.joinRequest',
    'group.transfer',
    'group.queueReady'
]);

const ACTIVITY_TYPES = new Set<string>([
    'inviteResponse',
    'requestInviteResponse',
    'message',
    'ignoredFriendRequest'
]);

export function getNotificationLifecycleBucket(
    type: unknown
): NotificationLifecycleBucket {
    const normalized = String(type || '');
    if (ACTION_TYPES.has(normalized)) {
        return 'action';
    }
    if (ACTIVITY_TYPES.has(normalized)) {
        return 'activity';
    }
    return 'system';
}
