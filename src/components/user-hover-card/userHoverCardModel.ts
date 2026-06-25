import {
    normalizeLocationStatus,
    readFriendInstanceEpoch,
    readFriendRef,
    readFriendStatusSource,
    timestampMsFromValue
} from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { userImage } from '@/services/entityMediaService';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { resolveTrustColorKey } from '@/shared/utils/trustColors';
import { computeTrustLevel } from '@/shared/utils/userTransforms';

export type UserHoverCardVariant =
    | 'in-instance'
    | 'private'
    | 'active'
    | 'offline'
    | 'profile-only';

function statusKeyFromStatus(status: any) {
    const normalized = normalizeLocationStatus(status);
    if (normalized === 'join me' || normalized === 'joinme') {
        return 'join_me';
    }
    if (normalized === 'ask me' || normalized === 'askme') {
        return 'ask_me';
    }
    if (normalized === 'busy') {
        return 'busy';
    }
    if (normalized === 'active') {
        return 'online';
    }
    return '';
}

function resolveTrust(identity: any) {
    const tags = Array.isArray(identity?.tags) ? identity.tags : [];
    const trust = computeTrustLevel(tags, identity?.developerType || '');
    const trustSource = {
        $trustClass: identity?.$trustClass || trust.trustClass,
        $isModerator: identity?.$isModerator ?? trust.isModerator,
        $isTroll: identity?.$isTroll ?? trust.isTroll,
        $isProbableTroll: identity?.$isProbableTroll ?? trust.isProbableTroll
    };
    return { trustSource, trustKey: resolveTrustColorKey(trustSource) };
}

function estimatedOnlineMs(state: any, lastLogin: any, nowMs: number) {
    if (normalizeLocationStatus(state) !== 'online') {
        return 0;
    }
    const lastLoginMs = timestampMsFromValue(lastLogin);
    if (!lastLoginMs || lastLoginMs > nowMs) {
        return 0;
    }
    return nowMs - lastLoginMs;
}

export function normalizeInstanceCounts(json: any) {
    if (!json || typeof json !== 'object') {
        return null;
    }
    const nUsers = Number(json.n_users ?? json.userCount);
    if (!Number.isFinite(nUsers)) {
        return null;
    }
    const capacity = Number(json.capacity ?? json.recommendedCapacity);
    return { nUsers, capacity: Number.isFinite(capacity) ? capacity : 0 };
}

export function buildUserHoverCardModel({ seed, profile, nowMs }: any) {
    const statusSource = seed ? readFriendStatusSource(seed) : null;
    const ref = readFriendRef(seed) || {};
    const identity = profile || ref || seed || {};

    const state = normalizeLocationStatus(
        statusSource?.stateBucket ||
            statusSource?.state ||
            profile?.stateBucket ||
            profile?.state
    );
    const hasPresence = Boolean(statusSource) && Boolean(state);

    const rawLocation = normalizeId(
        statusSource?.location ||
            statusSource?.$location?.tag ||
            profile?.location
    );
    const isTraveling = normalizeLocationStatus(rawLocation) === 'traveling';
    const travelingTo = normalizeId(
        statusSource?.travelingToLocation || statusSource?.$travelingToLocation
    );
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

    const { trustSource, trustKey } = resolveTrust(identity);

    return {
        variant,
        displayName:
            identity?.displayName ||
            identity?.username ||
            ref?.displayName ||
            normalizeId(identity?.id) ||
            'Unknown',
        avatarUrl: userImage(identity, true, '128'),
        avatarPreviewUrl: userImage(identity, false),
        userColour: identity?.$userColour || '',
        trustSource,
        trustKey,
        statusKey: statusKeyFromStatus(profile?.status || statusSource?.status),
        statusDescription: String(
            profile?.statusDescription || ref?.statusDescription || ''
        ).trim(),
        note: String(profile?.note || '').trim(),
        onlineForMs: estimatedOnlineMs(state, identity?.last_login, nowMs),
        instanceEpoch:
            variant === 'in-instance'
                ? timestampMsFromValue(
                      readFriendInstanceEpoch(statusSource, isTraveling)
                  )
                : 0,
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
