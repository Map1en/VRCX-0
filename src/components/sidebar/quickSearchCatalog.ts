import groupProfileRepository from '@/repositories/groupProfileRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import vrchatFavoriteRepository from '@/repositories/vrchatFavoriteRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';

export type QuickSearchCatalog = {
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

export type QuickSearchEntityType = 'friend' | 'avatar' | 'world' | 'group';

export type QuickSearchResult = {
    id: string;
    type: QuickSearchEntityType;
    source: string;
    name: string;
    subtitle?: string;
    imageUrl?: string;
    seedData?: Record<string, unknown> | null;
    memo?: string;
    note?: string;
    matchedField?: 'name' | 'memo' | 'note';
    userColour?: string;
};

function recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

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

function normalize(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function settledRows(result: PromiseSettledResult<unknown>): unknown[] {
    return result.status === 'fulfilled' && Array.isArray(result.value)
        ? result.value
        : [];
}

export function buildUserTextMap(rows: unknown, fieldName: string) {
    const map = new Map<string, unknown>();
    for (const row of Array.isArray(rows) ? rows : []) {
        const record = recordValue(row);
        const userId = normalize(record?.userId);
        if (userId) {
            map.set(userId, record?.[fieldName] || '');
        }
    }
    return map;
}

export async function loadQuickSearchCatalog({
    currentUserId
}: {
    currentUserId: string;
    endpoint?: string | null;
}) {
    const [
        ownAvatars,
        ownWorlds,
        favoriteAvatars,
        favoriteWorlds,
        groups,
        userMemos,
        userNotes
    ] = await Promise.allSettled([
        myAvatarRepository.getMyAvatars(),
        worldProfileRepository.getAllWorldsByUser({
            userId: currentUserId
        }),
        vrchatFavoriteRepository.getAllFavoriteAvatars(),
        vrchatFavoriteRepository.getAllFavoriteWorlds(),
        groupProfileRepository.getUserGroups({
            userId: currentUserId
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
    ].filter((result) => result.status === 'rejected').length;

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
