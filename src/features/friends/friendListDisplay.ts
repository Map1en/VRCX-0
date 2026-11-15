import { userStatusDotClassName } from '@/domain/friends/presence';
import { normalizeProfileLanguageRows } from '@/shared/utils/userLanguage';
import { userStatusSortRank } from '@/shared/utils/userStatus';

export function resolveFriendLanguageRows(friend: unknown) {
    return normalizeProfileLanguageRows(friend);
}

function resolveFriendStatusLabel(friend: unknown) {
    if (!friend || typeof friend !== 'object') {
        return '';
    }
    const record = Object.fromEntries(Object.entries(friend));
    return String(record.statusDescription ?? '').trim();
}

export function resolveFriendStatusMeta(friend: unknown) {
    return {
        badgeVariant: 'outline',
        statusDotClassName: userStatusDotClassName(friend),
        label: resolveFriendStatusLabel(friend),
        sortRank: userStatusSortRank(friend || 'offline')
    };
}
