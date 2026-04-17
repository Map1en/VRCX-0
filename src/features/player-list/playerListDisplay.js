import { AppleIcon, MonitorIcon, SmartphoneIcon } from 'lucide-react';

import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { userStatusIndicatorClassName } from '@/lib/userStatus.js';
import { languageMappings } from '@/shared/constants/language.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { normalizeString } from './playerListRows.js';

export function resolvePlatformMeta(platform) {
    const normalized = normalizeString(platform).toLowerCase();

    if (
        normalized === 'standalonewindows' ||
        normalized === 'pc' ||
        normalized === 'windows'
    ) {
        return {
            label: 'PC',
            icon: MonitorIcon,
            className: 'text-muted-foreground'
        };
    }

    if (normalized === 'android' || normalized === 'quest') {
        return {
            label: 'Android',
            icon: SmartphoneIcon,
            className: 'text-muted-foreground'
        };
    }

    if (normalized === 'ios') {
        return {
            label: 'iOS',
            icon: AppleIcon,
            className: 'text-muted-foreground'
        };
    }

    return {
        label: normalized || '',
        icon: null,
        className: 'text-muted-foreground'
    };
}

export function resolveStatusMeta(row) {
    const indicatorClassName = userStatusIndicatorClassName(row, {
        showOffline: true,
        className: 'mr-1'
    });

    if (row.isCurrentUser || row.isFavorite) {
        return {
            badgeVariant: 'default',
            indicatorClassName,
            label: row.statusDescription || ''
        };
    }

    if (row.isFriend) {
        return {
            badgeVariant: 'secondary',
            indicatorClassName,
            label: row.statusDescription || ''
        };
    }

    return {
        badgeVariant: 'outline',
        indicatorClassName,
        label: row.statusDescription || ''
    };
}

export function resolvePlatformMode(row) {
    if (row?.inVRMode === true) {
        return 'VR';
    }
    if (row?.inVRMode === false) {
        return row?.platformLabel === 'Android' || row?.platformLabel === 'iOS'
            ? 'M'
            : 'D';
    }
    return '';
}

export function getLanguageFlagLabel(languageKey) {
    const key = normalizeString(languageKey).toLowerCase();
    return languageMappings[key] || key || '';
}

export function languageClassName(languageKey) {
    return getLanguageFlagLabel(languageKey) || 'unknown';
}

export function languageCodeLabel(languageKey) {
    const key = normalizeString(languageKey)
        .toLowerCase()
        .replace(/^language_/, '');
    return key ? key.toUpperCase() : '';
}

export function getHomeWorldId(homeLocation) {
    if (!homeLocation) {
        return '';
    }

    if (typeof homeLocation === 'string') {
        return parseLocation(homeLocation).worldId || homeLocation;
    }

    return (
        normalizeString(homeLocation.worldId) ||
        normalizeString(homeLocation.id) ||
        normalizeString(homeLocation.location)
    );
}

export function formatCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : '-';
}

export function getWorldImage(world) {
    const imageUrl = world?.thumbnailImageUrl || world?.imageUrl || '';
    return imageUrl ? convertFileUrlToImageUrl(imageUrl, 256) : '';
}

export function resolvePlatformBadge(platform) {
    const normalized = normalizeString(platform).toLowerCase();
    if (
        normalized === 'pc' ||
        normalized === 'standalonewindows' ||
        normalized === 'windows'
    ) {
        return {
            key: 'PC',
            label: 'PC',
            icon: MonitorIcon
        };
    }
    if (normalized === 'quest' || normalized === 'android') {
        return {
            key: 'Quest',
            label: 'Android',
            icon: SmartphoneIcon
        };
    }
    if (normalized === 'ios') {
        return {
            key: 'iOS',
            label: 'iOS',
            icon: AppleIcon
        };
    }
    return {
        key: platform,
        label: platform,
        icon: null
    };
}

export function fileAnalysisSizeForPlatform(fileAnalysis, platformKey) {
    if (platformKey === 'PC') {
        return fileAnalysis?.standalonewindows?._fileSize || '';
    }
    if (platformKey === 'Quest' || platformKey === 'Android') {
        return fileAnalysis?.android?._fileSize || '';
    }
    if (platformKey === 'iOS') {
        return fileAnalysis?.ios?._fileSize || '';
    }
    return '';
}
