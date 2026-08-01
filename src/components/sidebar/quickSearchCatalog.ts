import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys
} from '@/lib/entityQueryCache';
import {
    commands,
    type QuickSearchCatalogSnapshot
} from '@/platform/tauri/bindings';

export type QuickSearchCatalog = QuickSearchCatalogSnapshot;

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
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

export function buildUserTextMap(rows: unknown, fieldName: string) {
    const map = new Map<string, unknown>();
    for (const row of Array.isArray(rows) ? rows : []) {
        const record = isRecord(row) ? row : null;
        const userId = normalize(record?.userId);
        if (userId) {
            map.set(userId, record?.[fieldName] || '');
        }
    }
    return map;
}

export function loadQuickSearchCatalog({
    currentEndpoint,
    currentUserId,
    force = false
}: {
    currentEndpoint?: string | null;
    currentUserId: string;
    force?: boolean;
}): Promise<QuickSearchCatalog> {
    const queryKey = queryKeys.quickSearchCatalog(
        currentUserId,
        currentEndpoint
    );
    return fetchCachedData({
        queryKey,
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: () => commands.appQuickSearchCatalogGet()
    }).then((catalog) => {
        if (catalog.status === 'partial') {
            void invalidateEntityQueries(queryKey);
        }
        return catalog;
    });
}
