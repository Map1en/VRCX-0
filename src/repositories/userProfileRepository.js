import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys,
    setCachedQueryData
} from '@/services/entityQueryCacheService.js';
import {
    computeTrustLevel,
    computeUserPlatform,
    createDefaultUserRef
} from '@/shared/utils/userTransforms.js';

import vrchatAuthRepository from './vrchatAuthRepository.js';
import vrchatFriendRepository from './vrchatFriendRepository.js';

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

async function getUserProfile({ userId, endpoint = '', force = false }) {
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
        policy: entityQueryPolicies.user,
        force,
        queryFn: async () => {
            const response = await vrchatFriendRepository.getUser({
                userId: normalizedUserId,
                endpoint
            });
            return response.json;
        }
    });
    return normalize(json);
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
            const response = await vrchatFriendRepository.executeGet(
                `users/${encodeURIComponent(normalizedUserId)}/groups`,
                {},
                { endpoint }
            );
            return Array.isArray(response.json) ? response.json : [];
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
            const response = await vrchatFriendRepository.executeGet(
                `users/${encodeURIComponent(normalizedUserId)}/groups/represented`,
                {},
                { endpoint }
            );
            return response.json && typeof response.json === 'object'
                ? response.json
                : null;
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

    const response = await vrchatFriendRepository.executeGet(
        `users/${encodeURIComponent(normalizedUserId)}/mutuals/friends`,
        { n, offset },
        { endpoint }
    );
    return Array.isArray(response.json) ? response.json : [];
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

    const response = await vrchatAuthRepository.execute(
        `users/${encodeURIComponent(normalizedUserId)}`,
        {
            endpoint,
            method: 'PUT',
            params
        }
    );
    const nextUser = normalize(response.json);
    setCachedQueryData(
        queryKeys.user(normalizedUserId, endpoint),
        response.json
    );
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

    await vrchatAuthRepository.execute(
        `users/${encodeURIComponent(normalizedUserId)}/badges/${encodeURIComponent(normalizedBadgeId)}`,
        {
            endpoint,
            method: 'PUT',
            params: {
                userId: normalizedUserId,
                badgeId: normalizedBadgeId,
                hidden: Boolean(hidden),
                showcased: Boolean(showcased)
            }
        }
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

    const response = await vrchatAuthRepository.execute(
        `users/${encodeURIComponent(normalizedUserId)}/addTags`,
        {
            endpoint,
            method: 'POST',
            params: { tags }
        }
    );
    const nextUser = normalize(response.json);
    setCachedQueryData(
        queryKeys.user(normalizedUserId, endpoint),
        response.json
    );
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

    const response = await vrchatAuthRepository.execute(
        `users/${encodeURIComponent(normalizedUserId)}/removeTags`,
        {
            endpoint,
            method: 'POST',
            params: { tags }
        }
    );
    const nextUser = normalize(response.json);
    setCachedQueryData(
        queryKeys.user(normalizedUserId, endpoint),
        response.json
    );
    return nextUser;
}

const userProfileRepository = Object.freeze({
    normalize,
    getUserProfile,
    getUserGroups,
    getRepresentedGroup,
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
    getMutualFriends,
    getAllMutualFriends,
    updateCurrentUser,
    updateCurrentUserBadge,
    addCurrentUserTags,
    removeCurrentUserTags
};
export default userProfileRepository;
