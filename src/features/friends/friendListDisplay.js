import {
    normalizeUserStatus,
    userStatusIndicatorClassName,
    userStatusSortRank
} from '@/lib/userStatus.js';
import { languageMappings } from '@/shared/constants/language.js';

export function languageFlagLabel(languageKey) {
    const countryCode = languageMappings[String(languageKey || '').toLowerCase()];
    if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) {
        return String(languageKey || '?').slice(0, 3).toUpperCase() || '?';
    }

    return String.fromCodePoint(
        ...countryCode
            .toUpperCase()
            .split('')
            .map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)
    );
}

export function languageTooltipLabel(entry) {
    const value = entry?.value || entry?.key || '';
    const key = entry?.key || '';
    if (value && key) {
        return `${value} (${key})`;
    }
    return value || key;
}

export function resolveFriendStatusMeta(friend) {
    const statusForIndicator = friend || {};
    const normalizedStatus = normalizeUserStatus(statusForIndicator);
    const indicatorClassName = userStatusIndicatorClassName(statusForIndicator, {
        showOffline: true,
        className: 'mr-1'
    });
    return {
        badgeVariant: 'outline',
        indicatorClassName,
        label:
            friend?.statusDescription ||
            (normalizedStatus === 'state-active' ? 'Active' : normalizedStatus),
        showIndicator: Boolean(indicatorClassName),
        sortRank: userStatusSortRank(statusForIndicator || 'offline')
    };
}
