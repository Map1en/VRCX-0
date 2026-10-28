import {
    firstFiniteLocationNumber,
    firstNonNegativeLocationNumber
} from '@/components/location/locationModel';
import type { SidebarFriendRecord } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import {
    presenceDotClassName,
    presenceLocationTag,
    presenceOf,
    presenceOnlineForMs,
    presenceSection,
    presenceTravelingTag
} from '@/domain/friends/presence';
import type {
    FriendProfileFields,
    FriendRecordInput
} from '@/domain/friends/types';
import { userImage } from '@/services/entityMediaService';
import { timestampMsFromValue } from '@/shared/utils/dateTime';
import {
    locationSentinel,
    normalizeLocationStatus,
    parseLocation
} from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { resolveTrustColorKey } from '@/shared/utils/trustColors';
import { userStatusLabelKey } from '@/shared/utils/userStatus';
import { computeTrustLevel } from '@/shared/utils/userTransforms';

type UserHoverCardVariant =
    | 'in-instance'
    | 'private'
    | 'active'
    | 'offline'
    | 'profile-only';

type HoverCardRecord = FriendRecordInput &
    Partial<FriendProfileFields> & {
        $userColour?: string;
        last_login?: number | string | null;
        note?: string | null;
    };

type UserHoverCardModelInput = {
    seed?: HoverCardRecord | SidebarFriendRecord | null;
    profile?: HoverCardRecord | null;
    localLocation?: string;
    nowMs: number;
};

function recordOrEmpty(value: unknown): HoverCardRecord {
    return isRecord(value) ? value : {};
}

function sidebarSeed(value: unknown): SidebarFriendRecord | null {
    return isRecord(value) ? value : null;
}

function resolveTrust(identity: HoverCardRecord) {
    const tags = Array.isArray(identity?.tags)
        ? identity.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];
    const trust = computeTrustLevel(
        tags,
        String(identity?.developerType || '')
    );
    const trustSource = {
        $trustClass: identity?.$trustClass || trust.trustClass,
        $isModerator: identity?.$isModerator ?? trust.isModerator,
        $isTroll: identity?.$isTroll ?? trust.isTroll,
        $isProbableTroll: identity?.$isProbableTroll ?? trust.isProbableTroll
    };
    return { trustSource, trustKey: resolveTrustColorKey(trustSource) };
}

export function normalizeInstanceCounts(json: unknown) {
    if (!isRecord(json)) {
        return null;
    }
    const nUsers = firstNonNegativeLocationNumber(
        json.userCount,
        json.occupants,
        json.n_users
    );
    if (nUsers === null) {
        return null;
    }
    return {
        nUsers,
        capacity:
            firstFiniteLocationNumber(
                json.capacity,
                json.recommendedCapacity
            ) ?? 0,
        full: json.hasCapacityForYou === false
    };
}

export function buildUserHoverCardModel({
    seed = null,
    profile = null,
    localLocation = '',
    nowMs
}: UserHoverCardModelInput) {
    const seedRecord = sidebarSeed(seed);
    const seedFields = recordOrEmpty(seedRecord);
    const profileRecord = recordOrEmpty(profile);
    const identity = profile ? profileRecord : seedFields;

    const presence = presenceOf(seedRecord) ?? presenceOf(profileRecord);
    const state = presence ? presenceSection(presence) : null;
    const hasPresence = Boolean(seedRecord) && state !== null;
    const status = profileRecord?.status || seedRecord?.status;

    const rawLocation =
        localLocation ||
        (presence
            ? presenceLocationTag(presence, { preferTraveling: false })
            : '');
    const isTraveling = locationSentinel(rawLocation) === 'traveling';
    const travelingTo = presence ? presenceTravelingTag(presence) : '';
    const effectiveLocation = isTraveling ? travelingTo : rawLocation;
    const parsed = parseLocation(effectiveLocation);
    const locationStatus = normalizeLocationStatus(effectiveLocation);

    let variant: UserHoverCardVariant;
    if (!hasPresence) {
        variant = 'profile-only';
    } else if (state === 'offline') {
        variant = 'offline';
    } else if (parsed.isRealInstance || (isTraveling && parsed.worldId)) {
        variant = 'in-instance';
    } else if (parsed.isPrivate || locationStatus === 'private') {
        variant = 'private';
    } else if (state === 'active') {
        variant = 'active';
    } else {
        variant = 'private';
    }

    const statusKey =
        hasPresence && state !== 'offline'
            ? userStatusLabelKey({ $presence: presence, status })
            : '';
    const statusDotClassName = hasPresence
        ? presenceDotClassName(presence, status)
        : '';
    const { trustSource, trustKey } = resolveTrust(identity);

    return {
        variant,
        displayName:
            identity?.displayName ||
            identity?.username ||
            seedFields?.displayName ||
            '',
        avatarUrl: userImage(identity, 128),
        avatarPreviewUrl: userImage(identity, 512),
        userColour: identity?.$userColour || '',
        trustSource,
        trustKey,
        statusKey,
        statusDotClassName,
        statusDescription: String(
            profileRecord?.statusDescription ||
                seedFields?.statusDescription ||
                ''
        ).trim(),
        note: String(profileRecord?.note || '').trim(),
        decorations: {
            iconFrame: String(
                identity?.iconFrame || seedFields?.iconFrame || ''
            ).trim(),
            profileEffect: String(
                identity?.profileEffect || seedFields?.profileEffect || ''
            ).trim(),
            nameplateEffect: String(
                identity?.nameplateEffect || seedFields?.nameplateEffect || ''
            ).trim()
        },
        onlineForMs: presenceOnlineForMs(presence, nowMs),
        lastOnlineAgoMs:
            variant === 'offline'
                ? (() => {
                      const lastLoginMs = timestampMsFromValue(
                          identity?.last_login
                      );
                      return lastLoginMs && lastLoginMs <= nowMs
                          ? nowMs - lastLoginMs
                          : 0;
                  })()
                : 0,
        location: {
            effectiveLocation,
            worldId: normalizeId(parsed.worldId),
            instanceId: normalizeId(parsed.instanceId),
            tag: normalizeId(parsed.tag),
            accessTypeName: parsed.accessTypeName || '',
            isRealInstance: Boolean(parsed.isRealInstance),
            isTraveling
        }
    };
}
