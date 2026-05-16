import {
    entityQueryPolicies,
    fetchCachedData,
    getCachedQueryData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache.js';
import { recordUserProfile } from '@/domain/users/userFactAccess.js';
import { backend } from '@/platform/index.js';
import {
    computeTrustLevel,
    computeUserPlatform,
    createDefaultUserRef
} from '@/shared/utils/userTransforms.js';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest.js';

type BackendApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

function normalizeUserProfile(user) {
    const base = createDefaultUserRef(user ?? {});
    const trust = computeTrustLevel(
        Array.isArray(base.tags) ? base.tags : [],
        base.developerType || ''
    );

    return {
        ...base,
        $trustLevel: trust.trustLevel,
        $trustClass: trust.trustClass,
        $trustSortNum: trust.trustSortNum,
        $isModerator: trust.isModerator,
        $isTroll: trust.isTroll,
        $isProbableTroll: trust.isProbableTroll,
        $platform: computeUserPlatform(base.platform, base.last_platform)
    };
}

async function collectPages(fetchPage, { pageSize = 100, maxPages = 50 } = {}) {
    const rows = [];

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

function normalize(user) {
    return normalizeUserProfile(user);
}

function hasOwnField(source, field) {
    return (
        source &&
        typeof source === 'object' &&
        Object.prototype.hasOwnProperty.call(source, field)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapBackendUserResponse<TJson = unknown>(
    response: BackendApiResult,
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

function mergeCurrentUserUpdateResponse(responseJson, cachedUser, params) {
    const responseUser =
        responseJson && typeof responseJson === 'object' ? responseJson : {};
    let nextUser = responseUser;

    if (
        Array.isArray(cachedUser?.badges) &&
        cachedUser.badges.length > 0 &&
        !hasOwnField(responseUser, 'badges') &&
        !hasOwnField(params, 'badges')
    ) {
        nextUser = {
            ...nextUser,
            badges: cachedUser.badges
        };
    }

    for (const [field, value] of Object.entries(params || {})) {
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
    dialog = false
}) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getUserProfile requires a user id.'
        );
    }

    const json = await fetchCachedData({
        queryKey: queryKeys.user(normalizedUserId, endpoint),
        policy: dialog
            ? entityQueryPolicies.userDialog
            : entityQueryPolicies.user,
        force,
        queryFn: async () => {
            const response = await backend.app.BackendUserGet({
                userId: normalizedUserId,
                endpoint
            });
            return unwrapBackendUserResponse(
                response,
                `users/${encodeURIComponent(normalizedUserId)}`
            ).json;
        }
    });
    const profile = normalize(json);
    recordUserProfile(profile, { endpoint, source: 'profile' });
    return profile;
}

async function getMutualCounts({ userId, endpoint = '' }) {
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
            const response = await backend.app.BackendUserMutualCountsGet({
                userId: normalizedUserId,
                endpoint
            });
            const json = unwrapBackendUserResponse(
                response,
                `users/${encodeURIComponent(normalizedUserId)}/mutuals`
            ).json;
            return json && typeof json === 'object' ? json : {};
        }
    });
}

async function getUserGroups({ userId, endpoint = '' }) {
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
            const response = await backend.app.BackendUserGroupsGet({
                userId: normalizedUserId,
                endpoint
            });
            const json = unwrapBackendUserResponse(
                response,
                `users/${encodeURIComponent(normalizedUserId)}/groups`
            ).json;
            return Array.isArray(json) ? json : [];
        }
    });
}

async function getRepresentedGroup({ userId, endpoint = '', force = false }) {
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
            const response = await backend.app.BackendUserRepresentedGroupGet({
                userId: normalizedUserId,
                endpoint
            });
            const json = unwrapBackendUserResponse(
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
}) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.getMutualFriends requires a user id.'
        );
    }

    const response = await backend.app.BackendUserMutualFriendsGet({
        userId: normalizedUserId,
        endpoint,
        n,
        offset
    });
    const json = unwrapBackendUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/mutuals/friends`
    ).json;
    return Array.isArray(json) ? json : [];
}

async function getAllMutualFriends({ userId, endpoint = '' }) {
    return collectPages(({ n, offset }) =>
        getMutualFriends({ userId, endpoint, n, offset })
    );
}

async function updateCurrentUser({ userId, endpoint = '', params = {} }) {
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
    const response = await backend.app.BackendCurrentUserUpdate({
        userId: normalizedUserId,
        endpoint,
        params
    });
    const json = unwrapBackendUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    ).json;
    const mergedJson = mergeCurrentUserUpdateResponse(
        json,
        cachedUser,
        params
    );
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
}) {
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

    const response = await backend.app.BackendCurrentUserBadgeUpdate({
        userId: normalizedUserId,
        badgeId: normalizedBadgeId,
        endpoint,
        hidden: Boolean(hidden),
        showcased: Boolean(showcased)
    });
    unwrapBackendUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/badges/${encodeURIComponent(normalizedBadgeId)}`
    );

    return getUserProfile({ userId: normalizedUserId, endpoint, force: true });
}

async function addCurrentUserTags({ userId, endpoint = '', tags = [] }) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.addCurrentUserTags requires a user id.'
        );
    }

    const response = await backend.app.BackendCurrentUserTagsAdd({
        userId: normalizedUserId,
        endpoint,
        tags: Array.isArray(tags) ? tags.map(String) : []
    });
    const json = unwrapBackendUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/addTags`
    ).json;
    const nextUser = normalize(json);
    setCachedQueryData(
        queryKeys.user(normalizedUserId, endpoint),
        json
    );
    recordUserProfile(nextUser, {
        endpoint,
        source: 'currentUser',
        isCurrentUser: true
    });
    return nextUser;
}

async function removeCurrentUserTags({ userId, endpoint = '', tags = [] }) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'UserProfileRepository.removeCurrentUserTags requires a user id.'
        );
    }

    const response = await backend.app.BackendCurrentUserTagsRemove({
        userId: normalizedUserId,
        endpoint,
        tags: Array.isArray(tags) ? tags.map(String) : []
    });
    const json = unwrapBackendUserResponse(
        response,
        `users/${encodeURIComponent(normalizedUserId)}/removeTags`
    ).json;
    const nextUser = normalize(json);
    setCachedQueryData(
        queryKeys.user(normalizedUserId, endpoint),
        json
    );
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
