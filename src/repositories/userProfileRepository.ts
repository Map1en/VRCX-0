import type {
    UserProfileEntity,
    UserProfileRecord
} from '@/domain/entities/profileEntities';
import {
    entityQueryPolicies,
    fetchCachedData,
    getCachedQueryData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import { recordUserProfile } from '@/services/userFactAccessService';
import { stripDefaultAvatarImage } from '@/shared/utils/avatar';
import {
    computeTrustLevel,
    computeUserPlatform,
    createDefaultUserRef,
    type UserRecord
} from '@/shared/utils/userTransforms';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { collectPages } from './pagination';
import { VRCHAT_API_DEFAULT_PAGE_SIZE } from './paginationConstants';
import { unwrapVrchatResponse } from './vrchatRequest';

type VrchatApiResult = {
    status: number;
    data: unknown;
};

type UserMutualCounts = {
    friends: number;
    groups: number;
};

type UserRepresentedGroup = Record<string, unknown> & {
    bannerId?: string;
    bannerUrl?: string;
    description?: string;
    discriminator?: string;
    groupId: string;
    iconId?: string;
    iconUrl?: string;
    isRepresenting?: boolean;
    memberCount?: number;
    memberVisibility?: string;
    name?: string;
    ownerId?: string;
    privacy?: string;
    shortCode?: string;
};

type UserMutualFriendRow = UserRecord & {
    bannerColor?: string;
    bannerType?: string;
    bannerUrl?: string;
    currentAvatarImageUrl?: string;
    currentAvatarTags?: string[];
    displayName?: string;
    iconFrame?: string;
    iconUrl?: string;
    id: string;
    imageUrl?: string;
    nameplateEffect?: string;
    profileEffect?: string;
    profilePicOverride?: string;
    status?: string;
    statusDescription?: string;
};

interface UserEndpointInput {
    userId?: unknown;
}

interface UserProfileInput extends UserEndpointInput {
    force?: boolean;
    dialog?: boolean;
    isFriend?: boolean | null;
}

interface UserAppearanceProfileInput extends UserEndpointInput {
    asSelf?: boolean;
}

interface UserGroupsInput extends UserEndpointInput {
    force?: boolean;
}

interface MutualFriendsInput extends UserEndpointInput {
    n?: number;
    offset?: number;
}

interface CurrentUserUpdateInput extends UserEndpointInput {
    params?: UserRecord;
}

interface CurrentUserBadgeInput extends UserEndpointInput {
    badgeId?: unknown;
    hidden?: boolean;
    showcased?: boolean;
}

interface CurrentUserTagsInput extends UserEndpointInput {
    tags?: unknown;
}

function normalizeUserProfile(user: unknown): UserProfileRecord {
    const source = isRecord(user) ? user : {};
    const base = stripDefaultAvatarImage(createDefaultUserRef(source));
    const trust = computeTrustLevel(
        Array.isArray(base.tags) ? base.tags : [],
        typeof base.developerType === 'string' ? base.developerType : ''
    );
    const hasUpstreamTrust =
        typeof source.$trustClass === 'string' && source.$trustClass.length > 0;
    const trustFields = hasUpstreamTrust
        ? {
              $trustLevel:
                  typeof source.$trustLevel === 'string'
                      ? source.$trustLevel
                      : '',
              $trustClass:
                  typeof source.$trustClass === 'string'
                      ? source.$trustClass
                      : '',
              $trustSortNum: Number(source.$trustSortNum) || 0,
              $isModerator: source.$isModerator === true,
              $isTroll: source.$isTroll === true,
              $isProbableTroll: source.$isProbableTroll === true
          }
        : {
              $trustLevel: trust.trustLevel,
              $trustClass: trust.trustClass,
              $trustSortNum: trust.trustSortNum,
              $isModerator: trust.isModerator,
              $isTroll: trust.isTroll,
              $isProbableTroll: trust.isProbableTroll
          };

    return {
        ...base,
        ...trustFields,
        $platform:
            typeof source.$platform === 'string' && source.$platform
                ? source.$platform
                : computeUserPlatform(
                      typeof base.platform === 'string' ? base.platform : '',
                      typeof base.last_platform === 'string'
                          ? base.last_platform
                          : ''
                  )
    };
}

function normalize(user: unknown): UserProfileRecord {
    return normalizeUserProfile(user);
}

function hasOwnField(source: unknown, field: PropertyKey) {
    return (
        source &&
        typeof source === 'object' &&
        Object.prototype.hasOwnProperty.call(source, field)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatUserResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string,
    fallbackMessage = 'VRChat user request failed'
) {
    return unwrapVrchatResponse<TJson>(response, path, { fallbackMessage });
}

function mergeCurrentUserUpdateResponse(
    responseJson: unknown,
    cachedUser: unknown,
    params: UserRecord = {}
): UserRecord {
    const responseUser: UserRecord = isRecord(responseJson) ? responseJson : {};
    const cachedUserRecord = isRecord(cachedUser) ? cachedUser : {};
    const paramsRecord = isRecord(params) ? params : {};
    let nextUser: UserRecord = responseUser;

    if (
        Array.isArray(cachedUserRecord.badges) &&
        cachedUserRecord.badges.length > 0 &&
        !hasOwnField(responseUser, 'badges') &&
        !hasOwnField(paramsRecord, 'badges')
    ) {
        nextUser = {
            ...nextUser,
            badges: cachedUserRecord.badges
        };
    }

    for (const [field, value] of Object.entries(paramsRecord)) {
        if (!hasOwnField(nextUser, field)) {
            if (nextUser === responseUser) {
                nextUser = { ...nextUser };
            }
            nextUser[field] = value;
        }
    }

    return nextUser;
}

async function getUserProfile({
    userId,
    force = false,
    dialog = false,
    isFriend = null
}: UserProfileInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getUserProfile requires a user id.'
        );
    }

    const response = await commands.appVrchatUserGet({
        userId: normalizedUserId,
        force,
        dialog,
        isFriend
    });
    const json = unwrapVrchatUserResponse<UserRecord>(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    ).json;
    return normalize(json);
}

async function getUserAppearanceProfile({
    userId,
    asSelf = false
}: UserAppearanceProfileInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getUserAppearanceProfile requires a user id.'
        );
    }

    const response = await commands.appVrchatUserProfileGet({
        userId: normalizedUserId,
        asSelf: asSelf === true
    });
    const json = unwrapVrchatUserResponse<UserProfileEntity>(
        response,
        `profile/${encodeURIComponent(normalizedUserId)}`
    ).json;
    return isRecord(json) ? json : {};
}

async function getMutualCounts({ userId }: UserEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getMutualCounts requires a user id.'
        );
    }

    return fetchCachedData({
        queryKey: queryKeys.mutualCounts(
            normalizedUserId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.mutualCounts,
        queryFn: async () => {
            const response = await commands.appVrchatUserMutualCountsGet({
                userId: normalizedUserId
            });
            const json = unwrapVrchatUserResponse<UserMutualCounts>(
                response,
                `users/${encodeURIComponent(normalizedUserId)}/mutuals`
            ).json;
            return {
                friends: Number(json?.friends) || 0,
                groups: Number(json?.groups) || 0
            };
        }
    });
}

async function getUserGroups({ userId }: UserEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getUserGroups requires a user id.'
        );
    }

    return fetchCachedData({
        queryKey: queryKeys.userGroups(
            normalizedUserId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.groupCollection,
        queryFn: async () => {
            const response = await commands.appVrchatUserGroupsGet({
                userId: normalizedUserId
            });
            const json = unwrapVrchatUserResponse(
                response,
                `users/${encodeURIComponent(normalizedUserId)}/groups`
            ).json;
            return Array.isArray(json) ? json : [];
        }
    });
}

async function getRepresentedGroup({ userId, force = false }: UserGroupsInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getRepresentedGroup requires a user id.'
        );
    }

    return fetchCachedData({
        queryKey: queryKeys.representedGroup(
            normalizedUserId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.representedGroup,
        force,
        queryFn: async () => {
            const response = await commands.appVrchatUserRepresentedGroupGet({
                userId: normalizedUserId
            });
            const json = unwrapVrchatUserResponse<UserRepresentedGroup>(
                response,
                `users/${encodeURIComponent(normalizedUserId)}/groups/represented`
            ).json;
            return json && typeof json === 'object' ? json : null;
        }
    });
}

async function getMutualFriends({
    userId,
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0
}: MutualFriendsInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getMutualFriends requires a user id.'
        );
    }

    const response = await commands.appVrchatUserMutualFriendsGet({
        userId: normalizedUserId,
        n,
        offset
    });
    const json = unwrapVrchatUserResponse<UserMutualFriendRow[]>(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/mutuals/friends`
    ).json;
    return Array.isArray(json) ? json : [];
}

async function getAllMutualFriends({ userId }: UserEndpointInput) {
    return collectPages(({ n, offset }) =>
        getMutualFriends({ userId, n, offset })
    );
}

async function updateCurrentUser({
    userId,
    params = {}
}: CurrentUserUpdateInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.updateCurrentUser requires a user id.'
        );
    }

    const queryKey = queryKeys.user(
        normalizedUserId,
        DEFAULT_VRCHAT_API_ENDPOINT
    );
    const cachedUser = getCachedQueryData(queryKey);
    const response = await commands.appVrchatCurrentUserUpdate({
        userId: normalizedUserId,
        params
    });
    const json = unwrapVrchatUserResponse<UserRecord>(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    ).json;
    const mergedJson = mergeCurrentUserUpdateResponse(json, cachedUser, params);
    const nextUser = normalize(mergedJson);
    setCachedQueryData(queryKey, mergedJson);
    recordUserProfile(nextUser, {
        endpoint: DEFAULT_VRCHAT_API_ENDPOINT,
        source: 'currentUser',
        isCurrentUser: true
    });
    return nextUser;
}

async function updateCurrentUserBadge({
    userId,
    badgeId = '',
    hidden = false,
    showcased = false
}: CurrentUserBadgeInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    const normalizedBadgeId =
        typeof badgeId === 'string'
            ? badgeId.trim()
            : String(badgeId ?? '').trim();
    if (!normalizedUserId || !normalizedBadgeId) {
        throw new Error(
            'UserProfileRepository.updateCurrentUserBadge requires a user id and badge id.'
        );
    }

    const response = await commands.appVrchatCurrentUserBadgeUpdate({
        userId: normalizedUserId,
        badgeId: normalizedBadgeId,
        hidden: Boolean(hidden),
        showcased: Boolean(showcased)
    });
    unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/badges/${encodeURIComponent(normalizedBadgeId)}`
    );

    return getUserProfile({ userId: normalizedUserId, force: true });
}

async function addCurrentUserTags({ userId, tags = [] }: CurrentUserTagsInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.addCurrentUserTags requires a user id.'
        );
    }

    const response = await commands.appVrchatCurrentUserTagsAdd({
        userId: normalizedUserId,
        tags: Array.isArray(tags) ? tags.map(String) : []
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/addTags`
    ).json;
    const nextUser = normalize(json);
    recordUserProfile(nextUser, {
        endpoint: DEFAULT_VRCHAT_API_ENDPOINT,
        source: 'currentUser',
        isCurrentUser: true
    });
    return nextUser;
}

async function removeCurrentUserTags({
    userId,
    tags = []
}: CurrentUserTagsInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.removeCurrentUserTags requires a user id.'
        );
    }

    const response = await commands.appVrchatCurrentUserTagsRemove({
        userId: normalizedUserId,
        tags: Array.isArray(tags) ? tags.map(String) : []
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/removeTags`
    ).json;
    const nextUser = normalize(json);
    recordUserProfile(nextUser, {
        endpoint: DEFAULT_VRCHAT_API_ENDPOINT,
        source: 'currentUser',
        isCurrentUser: true
    });
    return nextUser;
}

const userProfileRepository = Object.freeze({
    normalize,
    getUserProfile,
    getUserAppearanceProfile,
    getUserGroups,
    getRepresentedGroup,
    getMutualCounts,
    getMutualFriends,
    getAllMutualFriends,
    updateCurrentUser,
    updateCurrentUserBadge,
    addCurrentUserTags,
    removeCurrentUserTags
});

export {
    normalize,
    getUserProfile,
    getUserAppearanceProfile,
    getUserGroups,
    getRepresentedGroup,
    getMutualCounts,
    getMutualFriends,
    getAllMutualFriends,
    updateCurrentUser,
    updateCurrentUserBadge,
    addCurrentUserTags,
    removeCurrentUserTags
};
export type { UserProfileRecord } from '@/domain/entities/profileEntities';
export default userProfileRepository;
