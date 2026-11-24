import {
    SOLID_USER_STATUS_DOT_CLASS_NAMES,
    USER_STATUS_INDICATOR_CLASS_NAMES,
    userStatusFromValue
} from '@/shared/utils/friendStatus';
import {
    normalizeLocationValue,
    type ParsedLocation
} from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { computeUserPlatform } from '@/shared/utils/userTransforms';

import type { FriendRosterBucket } from './types';

export type PresencePlace = {
    location: ParsedLocation;
    travelingTo: ParsedLocation | null;
};

export type PresenceView =
    | {
          kind: 'online';
          place: PresencePlace;
          platform: string;
          onlineSinceMs: number | null;
      }
    | {
          kind: 'pendingOffline';
          place: PresencePlace;
          platform: string;
          onlineSinceMs: number | null;
          target: 'offline' | 'active';
          deadlineMs: number;
      }
    | { kind: 'active'; platform: string }
    | { kind: 'offline' };

export type PresenceEntry = { rev: number; view: PresenceView };

export function presenceSection(view: PresenceView): FriendRosterBucket {
    switch (view.kind) {
        case 'online':
        case 'pendingOffline':
            return 'online';
        case 'active':
            return 'active';
        case 'offline':
            return 'offline';
    }
}

export function presencePlace(view: PresenceView): PresencePlace | null {
    return view.kind === 'online' || view.kind === 'pendingOffline'
        ? view.place
        : null;
}

export function presenceOnlineForMs(
    view: PresenceView | null,
    nowMs: number
): number {
    if (view?.kind !== 'online' && view?.kind !== 'pendingOffline') {
        return 0;
    }
    const sinceMs = view.onlineSinceMs;
    return sinceMs !== null && sinceMs <= nowMs ? nowMs - sinceMs : 0;
}

const PRESENCE_KINDS = new Set([
    'online',
    'pendingOffline',
    'active',
    'offline'
]);

export function isPresenceView(value: unknown): value is PresenceView {
    return (
        isRecord(value) &&
        typeof value.kind === 'string' &&
        PRESENCE_KINDS.has(value.kind)
    );
}

export function presenceOf(value: unknown): PresenceView | null {
    return isRecord(value) && isPresenceView(value.$presence)
        ? value.$presence
        : null;
}

function hollowStatusDotClassName(status: string): string {
    switch (status) {
        case 'join me':
            return `${USER_STATUS_INDICATOR_CLASS_NAMES['join me']} border-[var(--status-joinme)] bg-background`;
        case 'ask me':
            return `${USER_STATUS_INDICATOR_CLASS_NAMES['ask me']} border-[var(--status-askme)] bg-background`;
        case 'busy':
            return `${USER_STATUS_INDICATOR_CLASS_NAMES.busy} border-[var(--status-busy)] bg-background`;
        default:
            return `${USER_STATUS_INDICATOR_CLASS_NAMES.active} border-[var(--status-online)] bg-background`;
    }
}

export function presenceDotClassName(
    view: PresenceView | null | undefined,
    status: unknown
): string {
    const friendStatus = userStatusFromValue(status);
    switch (view?.kind) {
        case 'offline':
        case 'pendingOffline':
            return SOLID_USER_STATUS_DOT_CLASS_NAMES.offline;
        case 'active':
            return hollowStatusDotClassName(friendStatus);
        case 'online':
            return friendStatus && friendStatus !== 'offline'
                ? SOLID_USER_STATUS_DOT_CLASS_NAMES[friendStatus]
                : '';
        default:
            return '';
    }
}

export function userStatusDotClassName(value: unknown): string {
    if (!isRecord(value)) {
        return '';
    }
    const presence = presenceOf(value);
    if (presence) {
        return presenceDotClassName(presence, value.status);
    }
    const friendStatus = userStatusFromValue(value.status);
    return friendStatus ? SOLID_USER_STATUS_DOT_CLASS_NAMES[friendStatus] : '';
}

export function presenceStatusKey(view: PresenceView, status: unknown): string {
    const friendStatus = userStatusFromValue(status);
    if (
        view.kind === 'offline' ||
        view.kind === 'pendingOffline' ||
        friendStatus === 'offline'
    ) {
        return 'offline';
    }
    if (
        friendStatus === 'join me' ||
        friendStatus === 'ask me' ||
        friendStatus === 'busy'
    ) {
        return friendStatus;
    }
    return view.kind === 'active' ? 'state-active' : 'active';
}

export function presenceLocationTag(
    view: PresenceView,
    {
        preferTraveling,
        requireInstance = false
    }: { preferTraveling: boolean; requireInstance?: boolean }
): string {
    const place = presencePlace(view);
    if (!place) {
        return requireInstance ? '' : 'offline';
    }
    const { location, travelingTo } = place;
    if (location.isPrivate) {
        return requireInstance ? '' : 'private';
    }
    if (location.isTraveling) {
        if (preferTraveling && travelingTo?.isRealInstance) {
            return travelingTo.tag;
        }
        return requireInstance ? '' : 'traveling';
    }
    if (!location.isRealInstance) {
        return '';
    }
    return requireInstance && !(location.worldId && location.instanceId)
        ? ''
        : location.tag;
}

export function resolveFriendPresenceLocation(
    value: unknown,
    options: { preferTraveling: boolean; requireInstance?: boolean }
): string {
    const presence = presenceOf(value);
    return presence ? presenceLocationTag(presence, options) : '';
}

export function presencePlatform(
    view: PresenceView,
    lastPlatform: string
): string {
    return computeUserPlatform(
        view.kind === 'offline' ? '' : view.platform,
        lastPlatform
    );
}

export function localGameLocation(
    time: { location: string; source: string } | null | undefined
): string {
    return time?.source === 'gameLog'
        ? normalizeLocationValue(time.location)
        : '';
}

export function presenceLiveInstanceTag(
    view: PresenceView,
    { preferTraveling }: { preferTraveling: boolean }
): string {
    return view.kind === 'online'
        ? presenceLocationTag(view, { preferTraveling, requireInstance: true })
        : '';
}

export function presenceTravelingTag(view: PresenceView): string {
    const place = presencePlace(view);
    return place?.location.isTraveling && place.travelingTo?.isRealInstance
        ? place.travelingTo.tag
        : '';
}
