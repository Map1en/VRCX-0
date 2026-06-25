import {
    AppleIcon,
    type LucideIcon,
    MonitorIcon,
    RectangleGogglesIcon
} from 'lucide-react';

import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { userStatusIndicatorClassName } from '@/shared/utils/userStatus';

export function resolvePlatformMeta(platform: any) {
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
            icon: RectangleGogglesIcon,
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

function isLivePlayerLocation(location: any) {
    const parsed = parseLocation(normalizeString(location));
    return Boolean(
        parsed.worldId &&
        !parsed.isOffline &&
        !parsed.isPrivate &&
        !parsed.isTraveling
    );
}

function normalizePlayerStatus(value: any) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'joinme') {
        return 'join me';
    }
    if (normalized === 'askme') {
        return 'ask me';
    }
    if (normalized === 'offline:offline' || normalized.startsWith('offline ')) {
        return 'offline';
    }
    return normalized;
}

function resolveStatusIndicatorSource(row: any) {
    if (!row?.isCurrentUser || !isLivePlayerLocation(row.location)) {
        return row;
    }

    const status = normalizePlayerStatus(row.status);
    return {
        location: row.location,
        state: 'online',
        stateBucket: 'online',
        status: status && status !== 'offline' ? status : 'active'
    };
}

export function resolveStatusMeta(row: any) {
    const indicatorClassName = userStatusIndicatorClassName(
        resolveStatusIndicatorSource(row),
        {
            showOffline: true,
            className: 'mr-1'
        }
    );

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

export function resolvePlatformMode(row: any) {
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

export function languageCodeLabel(languageKey: any) {
    const key = normalizeString(languageKey)
        .toLowerCase()
        .replace(/^language_/, '');
    return key ? key.toUpperCase() : '';
}

export function getHomeWorldId(homeLocation: any) {
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

export function formatCount(value: any) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : '-';
}

export function getWorldImage(world: any) {
    const imageUrl = world?.thumbnailImageUrl || world?.imageUrl || '';
    return imageUrl ? convertFileUrlToImageUrl(imageUrl, 256) : '';
}

export function resolvePlatformBadge(platform: any): {
    key: any;
    label: any;
    icon: LucideIcon | null;
} {
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
            icon: RectangleGogglesIcon
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

export function fileAnalysisSizeForPlatform(
    fileAnalysis: any,
    platformKey: any
) {
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
