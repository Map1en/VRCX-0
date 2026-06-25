import groupProfileRepository from '@/repositories/groupProfileRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import vrchatFavoriteRepository from '@/repositories/vrchatFavoriteRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';

type QuickSearchCatalog = {
    status: string;
    detail: string;
    ownAvatars: unknown[];
    favoriteAvatars: unknown[];
    ownWorlds: unknown[];
    favoriteWorlds: unknown[];
    groups: unknown[];
    userMemos: unknown[];
    userNotes: unknown[];
};

export function createEmptyCatalog(
    status: string = 'idle',
    detail: string = ''
): QuickSearchCatalog {
    return {
        status,
        detail,
        ownAvatars: [],
        favoriteAvatars: [],
        ownWorlds: [],
        favoriteWorlds: [],
        groups: [],
        userMemos: [],
        userNotes: []
    };
}

function normalize(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function settledRows(result: PromiseSettledResult<unknown>): unknown[] {
    return result.status === 'fulfilled' && Array.isArray(result.value)
        ? result.value
        : [];
}

export function buildUserTextMap(rows: any, fieldName: any) {
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        const userId = normalize(row?.userId);
        if (userId) {
            map.set(userId, row?.[fieldName] || '');
        }
    }
    return map;
}

export async function loadQuickSearchCatalog({ currentUserId, endpoint }: any) {
    const [
        ownAvatars,
        ownWorlds,
        favoriteAvatars,
        favoriteWorlds,
        groups,
        userMemos,
        userNotes
    ] = await Promise.allSettled([
        myAvatarRepository.getMyAvatars({ endpoint }),
        worldProfileRepository.getAllWorldsByUser({
            userId: currentUserId,
            endpoint
        }),
        vrchatFavoriteRepository.getAllFavoriteAvatars({ endpoint }),
        vrchatFavoriteRepository.getAllFavoriteWorlds({ endpoint }),
        groupProfileRepository.getUserGroups({
            userId: currentUserId,
            endpoint
        }),
        memoPersistenceRepository.getAllUserMemos(),
        memoPersistenceRepository.getAllUserNotes(currentUserId)
    ]);

    const rejectedCount = [
        ownAvatars,
        ownWorlds,
        favoriteAvatars,
        favoriteWorlds,
        groups,
        userMemos,
        userNotes
    ].filter((result: any) => result.status === 'rejected').length;

    return {
        ...createEmptyCatalog(
            'ready',
            rejectedCount
                ? `${rejectedCount} search source(s) failed to load.`
                : ''
        ),
        ownAvatars: settledRows(ownAvatars),
        ownWorlds: settledRows(ownWorlds),
        favoriteAvatars: settledRows(favoriteAvatars),
        favoriteWorlds: settledRows(favoriteWorlds),
        groups: settledRows(groups),
        userMemos: settledRows(userMemos),
        userNotes: settledRows(userNotes)
    };
}
