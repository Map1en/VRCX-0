import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache.js';

import avatarLocalRepository from './avatarLocalRepository.js';
import sqliteRepository from './sqliteRepository.js';
import userSessionRepository from './userSessionRepository.js';
import { executeVrchatRequest } from './vrchatRequest.js';

const PAGE_SIZE = 50;
const MAX_OFFSET = 5000;

async function execute(
    path,
    { endpoint = '', method = 'GET', params = null } = {}
) {
    return executeVrchatRequest(path, {
        endpoint,
        method,
        params,
        body: params,
        jsonBody: params !== null,
        fallbackMessage: 'VRChat avatar request failed'
    });
}

async function executeGet(path, params = {}, { endpoint = '' } = {}) {
    return execute(path, { endpoint, method: 'GET', params });
}

async function executePut(path, params = {}, { endpoint = '' } = {}) {
    return execute(path, { endpoint, method: 'PUT', params });
}

async function getAvatarsPage({
    endpoint = '',
    offset = 0,
    n = PAGE_SIZE
} = {}) {
    return executeGet(
        'avatars',
        {
            n,
            offset,
            sort: 'updated',
            order: 'descending',
            releaseStatus: 'all',
            user: 'me'
        },
        { endpoint }
    );
}

async function getMyAvatars({
    endpoint = '',
    currentUserId = '',
    currentAvatarId = '',
    previousAvatarSwapTime = 0
} = {}) {
    const avatars = [];

    if (currentUserId) {
        await userSessionRepository.ensureUserTables(currentUserId);
    }

    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
        const response = await getAvatarsPage({
            endpoint,
            offset,
            n: PAGE_SIZE
        });
        const page = Array.isArray(response.json) ? response.json : [];
        avatars.push(...page);

        if (page.length < PAGE_SIZE) {
            break;
        }
    }

    const [tagsMap, avatarTimeSpentMap] = await Promise.all([
        avatarLocalRepository.getAllAvatarTags(),
        currentUserId
            ? avatarLocalRepository.getAllAvatarTimeSpent(currentUserId)
            : Promise.resolve(new Map())
    ]);

    return avatars.map((avatar) => {
        const nextAvatar = {
            ...avatar,
            $tags: tagsMap.get(avatar.id) || [],
            $timeSpent: avatarTimeSpentMap.get(avatar.id) || 0
        };

        if (
            currentAvatarId &&
            avatar.id === currentAvatarId &&
            Number.isFinite(previousAvatarSwapTime) &&
            previousAvatarSwapTime > 0
        ) {
            nextAvatar.$timeSpent += Date.now() - previousAvatarSwapTime;
        }

        return nextAvatar;
    });
}

async function updateAvatarTags({
    avatarId,
    previousTags = [],
    nextTags = []
}) {
    const normalizedAvatarId =
        typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.updateAvatarTags requires an avatar id.'
        );
    }

    const previousMap = new Map(
        (Array.isArray(previousTags) ? previousTags : [])
            .filter(
                (entry) => typeof entry?.tag === 'string' && entry.tag.trim()
            )
            .map((entry) => [
                entry.tag.trim(),
                { tag: entry.tag.trim(), color: entry.color || null }
            ])
    );
    const nextMap = new Map(
        (Array.isArray(nextTags) ? nextTags : [])
            .filter(
                (entry) => typeof entry?.tag === 'string' && entry.tag.trim()
            )
            .map((entry) => [
                entry.tag.trim(),
                { tag: entry.tag.trim(), color: entry.color || null }
            ])
    );

    await sqliteRepository.transaction(async () => {
        for (const [tag] of previousMap) {
            if (!nextMap.has(tag)) {
                await avatarLocalRepository.removeAvatarTag(
                    normalizedAvatarId,
                    tag
                );
            }
        }

        for (const [tag, entry] of nextMap) {
            const previous = previousMap.get(tag);
            if (!previous) {
                await avatarLocalRepository.addAvatarTag(
                    normalizedAvatarId,
                    tag,
                    entry.color
                );
            } else if ((previous.color || null) !== (entry.color || null)) {
                await avatarLocalRepository.updateAvatarTagColor(
                    normalizedAvatarId,
                    tag,
                    entry.color
                );
            }
        }
    });

    return Array.from(nextMap.values());
}

async function saveAvatar({ avatarId, endpoint = '', params = {} }) {
    const normalizedAvatarId =
        typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error('MyAvatarRepository.saveAvatar requires an avatar id.');
    }

    const response = await executePut(
        `avatars/${encodeURIComponent(normalizedAvatarId)}`,
        {
            id: normalizedAvatarId,
            ...params
        },
        { endpoint }
    );

    return response.json;
}

async function createImpostor({ avatarId, endpoint = '' } = {}) {
    const normalizedAvatarId =
        typeof avatarId === 'string' ? avatarId.trim() : '';
    if (!normalizedAvatarId) {
        throw new Error(
            'MyAvatarRepository.createImpostor requires an avatar id.'
        );
    }

    const response = await execute(
        `avatars/${encodeURIComponent(normalizedAvatarId)}/impostor/enqueue`,
        {
            endpoint,
            method: 'POST'
        }
    );

    return response.json;
}

async function getAvailableAvatarStyles({ endpoint = '', force = false } = {}) {
    return fetchCachedData({
        queryKey: queryKeys.avatarStyles(endpoint),
        policy: entityQueryPolicies.avatarStyles,
        force,
        queryFn: async () => {
            const response = await executeGet('avatarStyles', {}, { endpoint });
            return Array.isArray(response.json) ? response.json : [];
        }
    });
}

const myAvatarRepository = Object.freeze({
    execute,
    executeGet,
    executePut,
    getAvatarsPage,
    getMyAvatars,
    updateAvatarTags,
    saveAvatar,
    createImpostor,
    getAvailableAvatarStyles
});

export {
    execute,
    executeGet,
    executePut,
    getAvatarsPage,
    getMyAvatars,
    updateAvatarTags,
    saveAvatar,
    createImpostor,
    getAvailableAvatarStyles
};
export default myAvatarRepository;
