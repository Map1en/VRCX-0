import type { FeedLiveEntry } from '@/domain/feed/feedLiveTypes';
import type { FeedReadModelResult } from '@/domain/feed/feedReadModelTypes';
import {
    commands,
    type FeedLiveRowsMergeInput,
    type FeedReadModelOutput,
    type FeedReadModelQueryInput,
    type FeedRowsQueryInput
} from '@/platform/tauri/bindings';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
} from '@/shared/constants/settings';
import { normalizeString } from '@/shared/utils/string';

import { normalizeUserTablePrefix } from './userSessionRepository';

type FeedRowValue = Record<string, unknown>;

type FeedDatabaseRow = FeedRowValue & {
    rowId?: unknown;
    sourceRank?: unknown;
    created_at?: unknown;
    userId?: unknown;
    displayName?: unknown;
    type?: unknown;
    location?: unknown;
    worldName?: unknown;
    previousLocation?: unknown;
    time?: unknown;
    groupName?: unknown;
    status?: unknown;
    statusDescription?: unknown;
    previousStatus?: unknown;
    previousStatusDescription?: unknown;
    bio?: unknown;
    previousBio?: unknown;
    ownerId?: unknown;
    avatarName?: unknown;
    currentAvatarImageUrl?: unknown;
    currentAvatarThumbnailImageUrl?: unknown;
    previousCurrentAvatarImageUrl?: unknown;
    previousCurrentAvatarThumbnailImageUrl?: unknown;
};

type FeedMode = 'search' | 'lookup' | 'instance' | string;
export type FeedCursor = {
    createdAt: string;
    sourceRank: number;
    rowId: number;
};

interface FeedRowsQueryOptions {
    userId: unknown;
    mode: FeedMode;
    search?: string;
    filters?: string[];
    vipList?: string[];
    excludedUserIds?: string[];
    maxEntries?: number;
    dateFrom?: string;
    dateTo?: string;
    cursor?: FeedCursor | null;
}

interface FeedReadModelQueryOptions extends FeedRowsQueryOptions {
    liveEntries?: FeedLiveEntry[];
    minLiveSequence?: number;
    favoritesOnly?: boolean;
    favoriteUserIds?: string[];
    excludedUserIds?: string[];
    maxRows?: number;
}

interface FeedLiveRowsMergeOptions {
    rows?: FeedRowValue[];
    currentUserId?: string;
    filters?: string[];
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    favoritesOnly?: boolean;
    favoriteUserIds?: string[];
    excludedUserIds?: string[];
    liveEntries?: FeedLiveEntry[];
    minLiveSequence?: number;
    maxRows?: number;
}

function normalizeStringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(normalizeString).filter(Boolean)
        : [];
}

function isFeedRowValue(value: unknown): value is FeedRowValue {
    return Boolean(value && typeof value === 'object');
}

function getUserPrefix(userId: unknown) {
    return normalizeUserTablePrefix(userId);
}

const ensuredFeedTablePrefixes = new Map<string, Promise<void>>();

function ensureFeedTablesForUser(userId: unknown): Promise<void> {
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

function markFeedTablesEnsured(userPrefix: unknown) {
    if (!userPrefix) {
        return;
    }
    ensuredFeedTablePrefixes.set(String(userPrefix), Promise.resolve());
}

function addFeedEntry(
    userId: unknown,
    type: unknown,
    entry: Record<string, unknown> = {}
) {
    return commands.appFeedAddEntry(normalizeString(userId), {
        ...entry,
        type
    });
}

async function queryFeedRows({
    userId,
    mode,
    search = '',
    filters = [],
    vipList = [],
    excludedUserIds = [],
    maxEntries = DEFAULT_MAX_TABLE_SIZE,
    dateFrom = '',
    dateTo = '',
    cursor = null
}: FeedRowsQueryOptions): Promise<FeedDatabaseRow[]> {
    await ensureFeedTablesForUser(userId);
    const query = {
        userId: normalizeString(userId),
        mode,
        search,
        filters: normalizeStringList(filters),
        vipList: normalizeStringList(vipList),
        excludedUserIds: normalizeStringList(excludedUserIds),
        maxEntries,
        dateFrom,
        dateTo,
        cursor
    } satisfies FeedRowsQueryInput;
    const rows: unknown = await commands.appFeedRowsQuery(query);
    return Array.isArray(rows) ? rows.filter(isFeedRowValue) : [];
}

function normalizeFeedReadModelResult(
    result: FeedReadModelOutput
): FeedReadModelResult<FeedRowValue> {
    const rows: unknown = result.rows;
    const maxSequence = Number(result.maxSequence);
    return {
        rows: Array.isArray(rows) ? rows.filter(isFeedRowValue) : [],
        maxSequence: Number.isFinite(maxSequence) ? maxSequence : 0
    };
}

const feed = {
    markFeedTablesEnsured,

    addGPSToDatabase(userId: unknown, entry: Record<string, unknown>) {
        return this.addGPSToDatabaseForUser(userId, entry);
    },

    async addGPSToDatabaseForUser(
        userId: unknown,
        entry: Record<string, unknown>
    ) {
        return addFeedEntry(userId, 'GPS', entry);
    },

    addStatusToDatabase(userId: unknown, entry: Record<string, unknown>) {
        return this.addStatusToDatabaseForUser(userId, entry);
    },

    async addStatusToDatabaseForUser(
        userId: unknown,
        entry: Record<string, unknown>
    ) {
        return addFeedEntry(userId, 'Status', entry);
    },

    addBioToDatabase(userId: unknown, entry: Record<string, unknown>) {
        return this.addBioToDatabaseForUser(userId, entry);
    },

    async addBioToDatabaseForUser(
        userId: unknown,
        entry: Record<string, unknown>
    ) {
        return addFeedEntry(userId, 'Bio', entry);
    },

    addAvatarToDatabase(userId: unknown, entry: Record<string, unknown>) {
        return this.addAvatarToDatabaseForUser(userId, entry);
    },

    async addAvatarToDatabaseForUser(
        userId: unknown,
        entry: Record<string, unknown>
    ) {
        return addFeedEntry(userId, 'Avatar', entry);
    },

    /**
     * @param {string|null} cutoffDate - null deletes every record, not just old ones.
     */
    async purgeAvatarFeedData(userId: unknown, cutoffDate: unknown) {
        await commands.appFeedAvatarPurge(
            normalizeString(userId),
            normalizeString(cutoffDate) || null
        );
    },

    addOnlineOfflineToDatabase(
        userId: unknown,
        entry: Record<string, unknown>
    ) {
        return this.addOnlineOfflineToDatabaseForUser(userId, entry);
    },

    async addOnlineOfflineToDatabaseForUser(
        userId: unknown,
        entry: Record<string, unknown>
    ) {
        return addFeedEntry(userId, entry?.type, entry);
    },

    async searchFeedDatabase(
        search: string,
        filters: string[],
        vipList: string[],
        maxEntries: number = DEFAULT_SEARCH_LIMIT,
        dateFrom: string = '',
        dateTo: string = '',
        userId: unknown = '',
        excludedUserIds: string[] = []
    ) {
        return queryFeedRows({
            userId,
            mode: 'search',
            search,
            filters,
            vipList,
            excludedUserIds,
            maxEntries,
            dateFrom,
            dateTo
        });
    },

    async queryFeedReadModel({
        userId,
        mode,
        search = '',
        filters = [],
        vipList = [],
        maxEntries = DEFAULT_MAX_TABLE_SIZE,
        dateFrom = '',
        dateTo = '',
        liveEntries = [],
        minLiveSequence = 0,
        favoritesOnly = false,
        favoriteUserIds = [],
        excludedUserIds = [],
        maxRows = maxEntries,
        cursor = null
    }: FeedReadModelQueryOptions) {
        await ensureFeedTablesForUser(userId);
        const query = {
            userId: normalizeString(userId),
            mode,
            search,
            filters: normalizeStringList(filters),
            vipList: normalizeStringList(vipList),
            maxEntries,
            dateFrom,
            dateTo,
            cursor,
            liveEntries: Array.isArray(liveEntries) ? liveEntries : [],
            minLiveSequence,
            favoritesOnly,
            favoriteUserIds: Array.isArray(favoriteUserIds)
                ? favoriteUserIds
                : [],
            excludedUserIds: normalizeStringList(excludedUserIds),
            maxRows
        } satisfies FeedReadModelQueryInput;
        return normalizeFeedReadModelResult(
            await commands.appFeedReadModelQuery(query)
        );
    },

    async mergeFeedLiveRows({
        rows = [],
        currentUserId = '',
        filters = [],
        search = '',
        dateFrom = '',
        dateTo = '',
        favoritesOnly = false,
        favoriteUserIds = [],
        excludedUserIds = [],
        liveEntries = [],
        minLiveSequence = 0,
        maxRows = DEFAULT_MAX_TABLE_SIZE
    }: FeedLiveRowsMergeOptions) {
        const query = {
            rows: Array.isArray(rows) ? rows : [],
            currentUserId: normalizeString(currentUserId),
            filters: normalizeStringList(filters),
            search,
            dateFrom,
            dateTo,
            favoritesOnly,
            favoriteUserIds: Array.isArray(favoriteUserIds)
                ? favoriteUserIds
                : [],
            excludedUserIds: normalizeStringList(excludedUserIds),
            liveEntries: Array.isArray(liveEntries) ? liveEntries : [],
            minLiveSequence,
            maxRows
        } satisfies FeedLiveRowsMergeInput;
        return normalizeFeedReadModelResult(
            await commands.appFeedLiveRowsMerge(query)
        );
    },

    async lookupFeedDatabase(
        userId: unknown,
        filters: string[],
        vipList: string[],
        maxEntries: number = DEFAULT_MAX_TABLE_SIZE,
        cursor: FeedCursor | null = null,
        excludedUserIds: string[] = []
    ) {
        return queryFeedRows({
            userId,
            mode: 'lookup',
            filters,
            vipList,
            excludedUserIds,
            maxEntries,
            cursor
        });
    },

    async getFeedByInstanceId(
        userId: unknown,
        instanceId: string,
        filters: string[],
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
    }
};

export { feed };
export default feed;
