import { backend } from '@/platform/index.js';

import { normalizeUserTablePrefix } from './userSessionRepository.js';

type FeedDatabaseRow = {
    [key: string]: unknown;
    rowId: unknown;
    created_at: unknown;
    userId: unknown;
    displayName: unknown;
    type: unknown;
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

const DEFAULT_MAX_TABLE_SIZE = 500;
const DEFAULT_SEARCH_TABLE_SIZE = 50000;

function getUserPrefix(userId) {
    return normalizeUserTablePrefix(userId);
}

const ensuredFeedTablePrefixes = new Map();

function ensureFeedTablesForUser(userId) {
    const userPrefix = getUserPrefix(userId);
    const existing = ensuredFeedTablePrefixes.get(userPrefix);
    if (existing) {
        return existing;
    }

    const promise = backend.app
        .UserTablesEnsure({
            userId:
                typeof userId === 'string'
                    ? userId.trim()
                    : String(userId ?? '').trim()
        })
        .catch((error) => {
            if (ensuredFeedTablePrefixes.get(userPrefix) === promise) {
                ensuredFeedTablePrefixes.delete(userPrefix);
            }
            throw error;
        });
    ensuredFeedTablePrefixes.set(userPrefix, promise);
    return promise;
}

function markFeedTablesEnsured(userPrefix) {
    if (!userPrefix) {
        return;
    }
    ensuredFeedTablePrefixes.set(userPrefix, Promise.resolve());
}

function addFeedEntry(userId, type, entry) {
    return backend.app.FeedAddEntry({
        userId:
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim(),
        entry: {
            ...(entry || {}),
            type
        }
    });
}

async function queryFeedRows({
    userId,
    mode,
    search = '',
    filters = [],
    vipList = [],
    maxEntries = DEFAULT_MAX_TABLE_SIZE,
    dateFrom = '',
    dateTo = ''
}) {
    await ensureFeedTablesForUser(userId);
    const rows = (await backend.app.FeedRowsQuery({
        query: {
            userId:
                typeof userId === 'string'
                    ? userId.trim()
                    : String(userId ?? '').trim(),
            mode,
            search,
            filters: Array.isArray(filters) ? filters : [],
            vipList: Array.isArray(vipList) ? vipList : [],
            maxEntries,
            dateFrom,
            dateTo
        }
    })) as FeedDatabaseRow[];
    return Array.isArray(rows) ? rows : [];
}

const feed = {
    markFeedTablesEnsured,

    addGPSToDatabase(userId, entry) {
        return this.addGPSToDatabaseForUser(userId, entry);
    },

    async addGPSToDatabaseForUser(userId, entry) {
        return addFeedEntry(userId, 'GPS', entry);
    },

    addStatusToDatabase(userId, entry) {
        return this.addStatusToDatabaseForUser(userId, entry);
    },

    async addStatusToDatabaseForUser(userId, entry) {
        return addFeedEntry(userId, 'Status', entry);
    },

    addBioToDatabase(userId, entry) {
        return this.addBioToDatabaseForUser(userId, entry);
    },

    async addBioToDatabaseForUser(userId, entry) {
        return addFeedEntry(userId, 'Bio', entry);
    },

    addAvatarToDatabase(userId, entry) {
        return this.addAvatarToDatabaseForUser(userId, entry);
    },

    async addAvatarToDatabaseForUser(userId, entry) {
        return addFeedEntry(userId, 'Avatar', entry);
    },

    /**
     * Purges avatar feed data from the database.
     * !!!!
     * @param {string|null} cutoffDate - ISO date string. Deletes records older than this date. If null, deletes all records.
     */
    async purgeAvatarFeedData(userId, cutoffDate) {
        await backend.app.FeedAvatarPurge({
            userId:
                typeof userId === 'string'
                    ? userId.trim()
                    : String(userId ?? '').trim(),
            cutoffDate: cutoffDate || null
        });
    },

    addOnlineOfflineToDatabase(userId, entry) {
        return this.addOnlineOfflineToDatabaseForUser(userId, entry);
    },

    async addOnlineOfflineToDatabaseForUser(userId, entry) {
        return addFeedEntry(userId, entry?.type, entry);
    },

    async searchFeedDatabase(
        search,
        filters,
        vipList,
        maxEntries = DEFAULT_SEARCH_TABLE_SIZE,
        dateFrom = '',
        dateTo = '',
        userId = ''
    ) {
        return queryFeedRows({
            userId,
            mode: 'search',
            search,
            filters,
            vipList,
            maxEntries,
            dateFrom,
            dateTo
        });
    },

    async lookupFeedDatabase(
        userId,
        filters,
        vipList,
        maxEntries = DEFAULT_MAX_TABLE_SIZE
    ) {
        return queryFeedRows({
            userId,
            mode: 'lookup',
            filters,
            vipList,
            maxEntries
        });
    },

    async getFeedByInstanceId(
        userId,
        instanceId,
        filters,
        vipList,
        maxEntries = DEFAULT_SEARCH_TABLE_SIZE
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
