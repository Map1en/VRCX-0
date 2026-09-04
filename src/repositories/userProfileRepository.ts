import type {
    UserProfileEntity,
    UserProfileRecord
} from '@/domain/entities/user';
import {
    entityQueryPolicies,
    fetchCachedData,
    getCachedQueryData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import {
    commands,
    type CurrentUserProfileUpdateRequest,
    type CurrentUserUpdateRequest,
    type HttpApiExecuteResponse
} from '@/platform/tauri/bindings';
import { stripDefaultAvatarImage } from '@/shared/utils/avatar';
import { isRecord } from '@/shared/utils/record';
import {
    computeTrustLevel,
    computeUserPlatform,
    createDefaultUserRef,
    type UserRecord
} from '@/shared/utils/userTransforms';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { unwrapVrchatResponse } from './vrchatRequest';

type VrchatApiResult = HttpApiExecuteResponse;

type UserFriendStatus = {
    incomingRequest: boolean;
    isFriend: boolean;
    outgoingRequest: boolean;
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
    userId?: string;
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

interface CurrentUserUpdateInput extends UserEndpointInput {
    params?: CurrentUserUpdateRequest;
}

export type ProfileBackgroundUpdate = CurrentUserProfileUpdateRequest;

interface CurrentUserProfileUpdateInput {
    expectedUserId?: string;
    params: CurrentUserProfileUpdateRequest;
}

interface CurrentUserBadgeInput extends UserEndpointInput {
    badgeId?: string;
    hidden?: boolean;
    showcased?: boolean;
}

interface CurrentUserTagsInput extends UserEndpointInput {
    tags?: string[];
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

function isUserMutualFriendRow(value: unknown): value is UserMutualFriendRow {
    return isRecord(value) && typeof value.id === 'string' && Boolean(value.id);
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
    params: CurrentUserUpdateRequest = {}
): UserRecord {
    const responseUser: UserRecord = isRecord(responseJson) ? responseJson : {};
    const cachedUserRecord = isRecord(cachedUser) ? cachedUser : {};
    const paramsRecord = params;
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
    const normalizedUserId = userId?.trim() ?? '';
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

async function getFriendStatus({
    userId
}: UserEndpointInput): Promise<UserFriendStatus> {
    const normalizedUserId = userId?.trim() ?? '';
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getFriendStatus requires a user id.'
        );
    }

    const response = await commands.appVrchatFriendStatusGet({
        userId: normalizedUserId
    });
    const json = unwrapVrchatUserResponse<Record<string, unknown>>(
        response,
        `user/${encodeURIComponent(normalizedUserId)}/friendStatus`
    ).json;
    const status = isRecord(json) ? json : {};

    return {
        incomingRequest: status.incomingRequest === true,
        isFriend: status.isFriend === true,
        outgoingRequest: status.outgoingRequest === true
    };
}

async function getUserAppearanceProfile({
    userId,
    asSelf = false
}: UserAppearanceProfileInput) {
    const normalizedUserId = userId?.trim() ?? '';
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getUserAppearanceProfile requires a user id.'
        );
    }

    const requestProfile = async () => {
        const response = await commands.appVrchatUserProfileGet({
            userId: normalizedUserId,
            asSelf
        });
        const json = unwrapVrchatUserResponse<UserProfileEntity>(
            response,
            `profile/${encodeURIComponent(normalizedUserId)}`
        ).json;
        return isRecord(json) ? json : {};
    };

    if (asSelf === true) {
        return requestProfile();
    }

    return fetchCachedData({
        queryKey: queryKeys.userAppearanceProfile(
            normalizedUserId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.userAppearanceProfile,
        queryFn: requestProfile
    });
}

async function getRepresentedGroup({ userId, force = false }: UserGroupsInput) {
    const normalizedUserId = userId?.trim() ?? '';
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

async function getAllMutualFriends({ userId }: UserEndpointInput) {
    const normalizedUserId = userId?.trim() ?? '';
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getAllMutualFriends requires a user id.'
        );
    }

    const { rows, persisted } = await commands.appUserMutualFriendsListGet({
        userId: normalizedUserId
    });
    const candidates: unknown[] = rows;
    return {
        rows: candidates.filter(isUserMutualFriendRow),
        persisted
    };
}

async function updateCurrentUser({
    userId,
    params = {}
}: CurrentUserUpdateInput) {
    const normalizedUserId = userId?.trim() ?? '';
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
        params
    });
    const json = unwrapVrchatUserResponse<UserRecord>(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    ).json;
    const mergedJson = mergeCurrentUserUpdateResponse(json, cachedUser, params);
    const nextUser = normalize(mergedJson);
    setCachedQueryData(queryKey, nextUser);
    return nextUser;
}

async function updateCurrentUserProfile({
    expectedUserId,
    params
}: CurrentUserProfileUpdateInput) {
    const normalizedUserId = expectedUserId?.trim() ?? '';
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.updateCurrentUserProfile requires a user id.'
        );
    }

    const response = await commands.appVrchatCurrentUserProfileUpdate({
        params
    });
    return unwrapVrchatUserResponse<UserProfileEntity>(
        response,
        `profile/${encodeURIComponent(normalizedUserId)}`
    ).json;
}

async function updateCurrentUserBadge({
    userId,
    badgeId = '',
    hidden = false,
    showcased = false
}: CurrentUserBadgeInput) {
    const normalizedUserId = userId?.trim() ?? '';
    const normalizedBadgeId = badgeId.trim();
    if (!normalizedUserId || !normalizedBadgeId) {
        throw new Error(
            'UserProfileRepository.updateCurrentUserBadge requires a user id and badge id.'
        );
    }

    const response = await commands.appVrchatCurrentUserBadgeUpdate({
        badgeId: normalizedBadgeId,
        hidden,
        showcased
    });
    unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/badges/${encodeURIComponent(normalizedBadgeId)}`
    );

    return getUserProfile({ userId: normalizedUserId, force: true });
}

async function addCurrentUserTags({ userId, tags = [] }: CurrentUserTagsInput) {
    const normalizedUserId = userId?.trim() ?? '';
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.addCurrentUserTags requires a user id.'
        );
    }

    const response = await commands.appVrchatCurrentUserTagsAdd({
        tags
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/addTags`
    ).json;
    return normalize(json);
}

async function removeCurrentUserTags({
    userId,
    tags = []
}: CurrentUserTagsInput) {
    const normalizedUserId = userId?.trim() ?? '';
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.removeCurrentUserTags requires a user id.'
        );
    }

    const response = await commands.appVrchatCurrentUserTagsRemove({
        tags
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/removeTags`
    ).json;
    return normalize(json);
}

const userProfileRepository = Object.freeze({
    normalize,
    getUserProfile,
    getFriendStatus,
    getUserAppearanceProfile,
    getRepresentedGroup,
    getAllMutualFriends,
    updateCurrentUserProfile,
    updateCurrentUser,
    updateCurrentUserBadge,
    addCurrentUserTags,
    removeCurrentUserTags
});

export {
    normalize,
    getUserProfile,
    getFriendStatus,
    getUserAppearanceProfile,
    getRepresentedGroup,
    getAllMutualFriends,
    updateCurrentUserProfile,
    updateCurrentUser,
    updateCurrentUserBadge,
    addCurrentUserTags,
    removeCurrentUserTags
};
export type { UserProfileRecord } from '@/domain/entities/user';
export default userProfileRepository;
