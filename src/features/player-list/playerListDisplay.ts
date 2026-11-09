import {
    AppleIcon,
    type LucideIcon,
    MonitorIcon,
    RectangleGogglesIcon
} from 'lucide-react';

import type { WorldProfileRecord } from '@/domain/entities/world';
import { userStatusDotClassName } from '@/domain/friends/presence';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';

import type { PlayerListRecord, PlayerListRow } from './playerListTypes';

type PlatformMeta = {
    label: string;
    icon: LucideIcon | null;
    className: string;
};

type StatusMeta = {
    badgeVariant: 'default' | 'secondary' | 'outline';
    statusDotClassName: string;
    label: string;
};

type PlayerStatusSource = PlayerListRecord & {
    isCurrentUser?: boolean;
    isFavorite?: boolean;
    isFriend?: boolean;
    status?: string;
    statusDescription?: string;
};

export function resolvePlatformMeta(platform: unknown): PlatformMeta {
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

export function resolveStatusMeta(row: PlayerStatusSource): StatusMeta {
    const statusDotClassName = userStatusDotClassName(row);

    if (row.isCurrentUser || row.isFavorite) {
        return {
            badgeVariant: 'default',
            statusDotClassName,
            label: normalizeString(row.statusDescription)
        };
    }

    if (row.isFriend) {
        return {
            badgeVariant: 'secondary',
            statusDotClassName,
            label: normalizeString(row.statusDescription)
        };
    }

    return {
        badgeVariant: 'outline',
        statusDotClassName,
        label: normalizeString(row.statusDescription)
    };
}

export function resolvePlatformMode(
    row: Pick<PlayerListRow, 'inVRMode' | 'platformLabel'>
) {
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

export function languageCodeLabel(languageKey: string) {
    const key = languageKey.toLowerCase().replace(/^language_/, '');
    return key ? key.toUpperCase() : '';
}

export function getHomeWorldId(homeLocation: unknown) {
    if (!homeLocation) {
        return '';
    }

    if (typeof homeLocation === 'string') {
        return parseLocation(homeLocation).worldId || homeLocation;
    }

    if (!isRecord(homeLocation)) {
        return '';
    }

    return (
        normalizeString(homeLocation.worldId) ||
        normalizeString(homeLocation.id) ||
        normalizeString(homeLocation.location)
    );
}

export function getWorldImage(
    world:
        | Partial<Pick<WorldProfileRecord, 'thumbnailImageUrl' | 'imageUrl'>>
        | null
        | undefined
) {
    const imageUrl = (world?.thumbnailImageUrl || world?.imageUrl || '').trim();
    return imageUrl ? convertFileUrlToImageUrl(imageUrl, 256) : '';
}
