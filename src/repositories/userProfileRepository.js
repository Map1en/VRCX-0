import {
    computeTrustLevel,
    computeUserPlatform,
    createDefaultUserRef
} from '@/shared/utils/userTransforms.js';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys,
    setCachedQueryData
} from '@/services/entityQueryCacheService.js';

import vrchatFriendRepository from './vrchatFriendRepository.js';
import vrchatAuthRepository from './vrchatAuthRepository.js';

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

class UserProfileRepository {
    normalize(user) {
        return normalizeUserProfile(user);
    }

    async getUserProfile({ userId, endpoint = '', force = false }) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('UserProfileRepository.getUserProfile requires a user id.');
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
        return this.normalize(json);
    }

    async getUserGroups({ userId, endpoint = '' }) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('UserProfileRepository.getUserGroups requires a user id.');
        }

        return fetchCachedData({
            queryKey: ['user', normalizedUserId, 'groups', endpoint || ''],
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

    async getRepresentedGroup({ userId, endpoint = '', force = false }) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('UserProfileRepository.getRepresentedGroup requires a user id.');
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
                return response.json && typeof response.json === 'object' ? response.json : null;
            }
        });
    }

    async getMutualFriends({ userId, endpoint = '', n = 100, offset = 0 }) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('UserProfileRepository.getMutualFriends requires a user id.');
        }

        const response = await vrchatFriendRepository.executeGet(
            `users/${encodeURIComponent(normalizedUserId)}/mutuals/friends`,
            { n, offset },
            { endpoint }
        );
        return Array.isArray(response.json) ? response.json : [];
    }

    async getAllMutualFriends({ userId, endpoint = '' }) {
        return collectPages(({ n, offset }) =>
            this.getMutualFriends({ userId, endpoint, n, offset })
        );
    }

    async updateCurrentUser({ userId, endpoint = '', params = {} }) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('UserProfileRepository.updateCurrentUser requires a user id.');
        }

        const response = await vrchatAuthRepository.execute(
            `users/${encodeURIComponent(normalizedUserId)}`,
            {
                endpoint,
                method: 'PUT',
                params
            }
        );
        const nextUser = this.normalize(response.json);
        setCachedQueryData(queryKeys.user(normalizedUserId, endpoint), response.json);
        return nextUser;
    }

    async updateCurrentUserBadge({ userId, endpoint = '', badgeId = '', hidden = false, showcased = false }) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        const normalizedBadgeId =
            typeof badgeId === 'string' ? badgeId.trim() : String(badgeId ?? '').trim();
        if (!normalizedUserId || !normalizedBadgeId) {
            throw new Error('UserProfileRepository.updateCurrentUserBadge requires a user id and badge id.');
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

        return this.getUserProfile({ userId: normalizedUserId, endpoint, force: true });
    }

    async addCurrentUserTags({ userId, endpoint = '', tags = [] }) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('UserProfileRepository.addCurrentUserTags requires a user id.');
        }

        const response = await vrchatAuthRepository.execute(
            `users/${encodeURIComponent(normalizedUserId)}/addTags`,
            {
                endpoint,
                method: 'POST',
                params: { tags }
            }
        );
        const nextUser = this.normalize(response.json);
        setCachedQueryData(queryKeys.user(normalizedUserId, endpoint), response.json);
        return nextUser;
    }

    async removeCurrentUserTags({ userId, endpoint = '', tags = [] }) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('UserProfileRepository.removeCurrentUserTags requires a user id.');
        }

        const response = await vrchatAuthRepository.execute(
            `users/${encodeURIComponent(normalizedUserId)}/removeTags`,
            {
                endpoint,
                method: 'POST',
                params: { tags }
            }
        );
        const nextUser = this.normalize(response.json);
        setCachedQueryData(queryKeys.user(normalizedUserId, endpoint), response.json);
        return nextUser;
    }
}

const userProfileRepository = new UserProfileRepository();

export { UserProfileRepository };
export default userProfileRepository;
