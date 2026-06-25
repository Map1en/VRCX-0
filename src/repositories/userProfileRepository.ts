import { recordUserProfile } from '@/domain/users/userFactAccess';
import {
    entityQueryPolicies,
    fetchCachedData,
    getCachedQueryData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import { stripDefaultAvatarImage } from '@/shared/utils/avatar';
import {
    computeTrustLevel,
    computeUserPlatform,
    createDefaultUserRef,
    type UserRecord
} from '@/shared/utils/userTransforms';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest';

type VrchatApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

type UserProfileRecord = UserRecord & {
    id?: string;
    displayName?: string;
    username?: string;
    name?: string;
    $trustLevel: string;
    $trustClass: string;
    $trustSortNum: number;
    $isModerator: boolean;
    $isTroll: boolean;
    $isProbableTroll: boolean;
    $platform: string;
};

interface PageRequest {
    n: number;
    offset: number;
}

interface CollectPagesOptions {
    pageSize?: number;
    maxPages?: number;
}

interface UserEndpointInput {
    userId?: unknown;
    endpoint?: string;
}

interface UserProfileInput extends UserEndpointInput {
    force?: boolean;
    dialog?: boolean;
    isFriend?: boolean | null;
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

async function collectPages<T>(
    fetchPage: (page: PageRequest) => Promise<T[]>,
    { pageSize = 100, maxPages = 50 }: CollectPagesOptions = {}
): Promise<T[]> {
    const rows: T[] = [];

    for (let page = 0; page < maxPages; page += 1) {
        const nextRows = await fetchPage({
            n: pageSize,
            offset: page * pageSize
        });
        rows.push(...nextRows);

        if (nextRows.length < pageSize) {
            break;
        }
    }

    return rows;
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
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw requestError;
    }

    return {
        json: json as TJson,
        status: response.status,
        raw: response.raw
    };
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
    endpoint = '',
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
        endpoint,
        force,
        dialog,
        isFriend
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    ).json;
    return normalize(json);
}

async function getMutualCounts({ userId, endpoint = '' }: UserEndpointInput) {
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
        queryKey: queryKeys.mutualCounts(normalizedUserId, endpoint),
        policy: entityQueryPolicies.mutualCounts,
        queryFn: async () => {
            const response = await commands.appVrchatUserMutualCountsGet({
                userId: normalizedUserId,
                endpoint
            });
            const json = unwrapVrchatUserResponse(
                response,
                `users/${encodeURIComponent(normalizedUserId)}/mutuals`
            ).json;
            return json && typeof json === 'object' ? json : {};
        }
    });
}

async function getUserGroups({ userId, endpoint = '' }: UserEndpointInput) {
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
        queryKey: queryKeys.userGroups(normalizedUserId, endpoint),
        policy: entityQueryPolicies.groupCollection,
        queryFn: async () => {
            const response = await commands.appVrchatUserGroupsGet({
                userId: normalizedUserId,
                endpoint
            });
            const json = unwrapVrchatUserResponse(
                response,
                `users/${encodeURIComponent(normalizedUserId)}/groups`
            ).json;
            return Array.isArray(json) ? json : [];
        }
    });
}

async function getRepresentedGroup({
    userId,
    endpoint = '',
    force = false
}: UserGroupsInput) {
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
        queryKey: queryKeys.representedGroup(normalizedUserId, endpoint),
        policy: entityQueryPolicies.representedGroup,
        force,
        queryFn: async () => {
            const response = await commands.appVrchatUserRepresentedGroupGet({
                userId: normalizedUserId,
                endpoint
            });
            const json = unwrapVrchatUserResponse(
                response,
                `users/${encodeURIComponent(normalizedUserId)}/groups/represented`
            ).json;
            return json && typeof json === 'object' ? json : null;
        }
    });
}

async function getMutualFriends({
    userId,
    endpoint = '',
    n = 100,
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
        endpoint,
        n,
        offset
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/mutuals/friends`
    ).json;
    return Array.isArray(json) ? json : [];
}

async function getAllMutualFriends({
    userId,
    endpoint = ''
}: UserEndpointInput) {
    return collectPages(({ n, offset }) =>
        getMutualFriends({ userId, endpoint, n, offset })
    );
}

async function updateCurrentUser({
    userId,
    endpoint = '',
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

    const queryKey = queryKeys.user(normalizedUserId, endpoint);
    const cachedUser = getCachedQueryData(queryKey);
    const response = await commands.appVrchatCurrentUserUpdate({
        userId: normalizedUserId,
        endpoint,
        params
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    ).json;
    const mergedJson = mergeCurrentUserUpdateResponse(json, cachedUser, params);
    const nextUser = normalize(mergedJson);
    setCachedQueryData(queryKey, mergedJson);
    recordUserProfile(nextUser, {
        endpoint,
        source: 'currentUser',
        isCurrentUser: true
    });
    return nextUser;
}

async function updateCurrentUserBadge({
    userId,
    endpoint = '',
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
        endpoint,
        hidden: Boolean(hidden),
        showcased: Boolean(showcased)
    });
    unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/badges/${encodeURIComponent(normalizedBadgeId)}`
    );

    return getUserProfile({ userId: normalizedUserId, endpoint, force: true });
}

async function addCurrentUserTags({
    userId,
    endpoint = '',
    tags = []
}: CurrentUserTagsInput) {
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
        endpoint,
        tags: Array.isArray(tags) ? tags.map(String) : []
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/addTags`
    ).json;
    const nextUser = normalize(json);
    recordUserProfile(nextUser, {
        endpoint,
        source: 'currentUser',
        isCurrentUser: true
    });
    return nextUser;
}

async function removeCurrentUserTags({
    userId,
    endpoint = '',
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
        endpoint,
        tags: Array.isArray(tags) ? tags.map(String) : []
    });
    const json = unwrapVrchatUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/removeTags`
    ).json;
    const nextUser = normalize(json);
    recordUserProfile(nextUser, {
        endpoint,
        source: 'currentUser',
        isCurrentUser: true
    });
    return nextUser;
}

const userProfileRepository = Object.freeze({
    normalize,
    getUserProfile,
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
export default userProfileRepository;
