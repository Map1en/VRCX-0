import { normalizeProfileLanguageRows } from '@/shared/utils/userLanguage';
import {
    userStatusIndicatorClassName,
    userStatusSortRank
} from '@/shared/utils/userStatus';

export function languageCodeLabel(languageKey: any) {
    const key = String(languageKey ?? '')
        .trim()
        .toLowerCase()
        .replace(/^language_/, '');
    return key ? key.toUpperCase() : '';
}

export function languageTooltipLabel(entry: any, code: any) {
    const value = String(
        entry?.value || entry?.label || entry?.name || ''
    ).trim();
    return value || code;
}

export function resolveFriendLanguageRows(friend: any) {
    return normalizeProfileLanguageRows(friend);
}

function resolveFriendStatusLabel(friend: any) {
    return String(friend?.statusDescription ?? '').trim();
}

export function resolveFriendStatusMeta(friend: any) {
    const statusForIndicator = friend || {};
    const indicatorClassName = userStatusIndicatorClassName(
        statusForIndicator,
        {
            showOffline: true,
            className: 'mr-1'
        }
    );
    return {
        badgeVariant: 'outline',
        indicatorClassName,
        label: resolveFriendStatusLabel(friend),
        showIndicator: Boolean(indicatorClassName),
        sortRank: userStatusSortRank(statusForIndicator || 'offline')
    };
}
