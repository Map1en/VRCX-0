import type { FeedCursor } from '@/domain/feed/readModel';
import {
    commands,
    type FeedFilter,
    type FeedLatestQueryInput,
    type FeedQueryMode,
    type FeedRowOutput,
    type FeedRowsQueryInput,
    type FeedSearchQueryInput
} from '@/platform/tauri/bindings';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
} from '@/shared/constants/settings';
import { normalizeString } from '@/shared/utils/string';

import { normalizeUserTablePrefix } from './userSessionRepository';

export type { FeedCursor } from '@/domain/feed/readModel';

interface FeedRowsQueryOptions {
    userId: string;
    mode: FeedQueryMode;
    search?: string;
    filters?: FeedFilter[];
    vipList?: string[];
    scopedUserIds?: string[];
    excludedUserIds?: string[];
    maxEntries?: number;
    dateFrom?: string;
    dateTo?: string;
    cursor?: FeedCursor | null;
}

interface FeedLatestQueryOptions {
    userId: string;
    filters?: FeedFilter[];
    favoriteUserIds?: string[];
    scopedUserIds?: string[];
    excludedUserIds?: string[];
    favoritesOnly?: boolean;
    maxRows?: number;
}

function normalizeStringList(value: string[]): string[] {
    return value.map((entry) => entry.trim()).filter(Boolean);
}

function getUserPrefix(userId: string) {
    return normalizeUserTablePrefix(userId);
}

const ensuredFeedTablePrefixes = new Map<string, Promise<void>>();

function ensureFeedTablesForUser(userId: string): Promise<void> {
    const userPrefix = getUserPrefix(userId);
    const existing = ensuredFeedTablePrefixes.get(userPrefix);
    if (existing) {
        return existing;
    }

    const promise = commands
        .appUserTablesEnsure(normalizeString(userId))
        .then((): void => undefined)
        .catch((error: unknown) => {
            if (ensuredFeedTablePrefixes.get(userPrefix) === promise) {
                ensuredFeedTablePrefixes.delete(userPrefix);
            }
            throw error;
        });
    ensuredFeedTablePrefixes.set(userPrefix, promise);
    return promise;
}

function markFeedTablesEnsured(userPrefix: string) {
    if (!userPrefix) {
        return;
    }
    ensuredFeedTablePrefixes.set(userPrefix, Promise.resolve());
}

async function queryFeedRows({
    userId,
    mode,
    search = '',
    filters = [],
    vipList = [],
    scopedUserIds = [],
    excludedUserIds = [],
    maxEntries = DEFAULT_MAX_TABLE_SIZE,
    dateFrom = '',
    dateTo = '',
    cursor = null
}: FeedRowsQueryOptions): Promise<FeedRowOutput[]> {
    await ensureFeedTablesForUser(userId);
    const query = {
        userId: normalizeString(userId),
        mode,
        search,
        filters,
        vipList: normalizeStringList(vipList),
        scopedUserIds: normalizeStringList(scopedUserIds),
        excludedUserIds: normalizeStringList(excludedUserIds),
        maxEntries,
        dateFrom,
        dateTo,
        cursor
    } satisfies FeedRowsQueryInput;
    return commands.appFeedRowsQuery(query);
}

const feed = {
    markFeedTablesEnsured,

    async searchFeedDatabase(
        search: string,
        filters: FeedFilter[],
        vipList: string[],
        maxEntries: number = DEFAULT_SEARCH_LIMIT,
        dateFrom: string = '',
        dateTo: string = '',
        userId: string = '',
        excludedUserIds: string[] = [],
        scopedUserIds: string[] = [],
        favoritesOnly: boolean = false
    ) {
        await ensureFeedTablesForUser(userId);
        const query = {
            userId: normalizeString(userId),
            search,
            filters,
            favoriteUserIds: normalizeStringList(vipList),
            scopedUserIds: normalizeStringList(scopedUserIds),
            excludedUserIds: normalizeStringList(excludedUserIds),
            favoritesOnly,
            dateFrom,
            dateTo,
            maxRows: maxEntries
        } satisfies FeedSearchQueryInput;
        return commands.appFeedSearchQuery(query);
    },

    async queryFeedLatest({
        userId,
        filters = [],
        favoriteUserIds = [],
        scopedUserIds = [],
        favoritesOnly = false,
        excludedUserIds = [],
        maxRows = DEFAULT_MAX_TABLE_SIZE
    }: FeedLatestQueryOptions) {
        await ensureFeedTablesForUser(userId);
        const query = {
            userId: normalizeString(userId),
            filters,
            favoriteUserIds: normalizeStringList(favoriteUserIds),
            scopedUserIds: normalizeStringList(scopedUserIds),
            favoritesOnly,
            excludedUserIds: normalizeStringList(excludedUserIds),
            maxRows
        } satisfies FeedLatestQueryInput;
        return commands.appFeedLatestQuery(query);
    },

    async lookupFeedDatabase(
        userId: string,
        filters: FeedFilter[],
        vipList: string[],
        maxEntries: number = DEFAULT_MAX_TABLE_SIZE,
        cursor: FeedCursor | null = null,
        excludedUserIds: string[] = [],
        scopedUserIds: string[] = []
    ) {
        return queryFeedRows({
            userId,
            mode: 'lookup',
            filters,
            vipList,
            scopedUserIds,
            excludedUserIds,
            maxEntries,
            cursor
        });
    },

    async getFeedByInstanceId(
        userId: string,
        instanceId: string,
        filters: FeedFilter[],
        vipList: string[],
        maxEntries: number = DEFAULT_SEARCH_LIMIT
    ) {
        return queryFeedRows({
            userId,
            mode: 'instance',
            search: instanceId,
            filters,
            vipList,
            maxEntries
        });
    },

    async getWorldFriendVisits(worldId: string) {
        const normalizedWorldId = normalizeString(worldId);
        if (!normalizedWorldId) {
            return null;
        }
        return commands.appWorldFriendVisits(normalizedWorldId);
    }
};

export default feed;
