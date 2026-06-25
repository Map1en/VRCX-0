import configRepository from './configRepository';
import feedPersistenceRepository from './feedPersistenceRepository';
import type { FeedCursor } from './feedPersistenceRepository';
import userSessionRepository from './userSessionRepository';

export const FEED_FILTER_TYPES = Object.freeze([
    'GPS',
    'Online',
    'Offline',
    'Status',
    'Avatar',
    'Bio'
] as const);

export type FeedFilterType = (typeof FEED_FILTER_TYPES)[number];
export type FeedEntry = Record<string, unknown>;

export interface FeedQueryOptions {
    userId: unknown;
    search?: unknown;
    filters?: unknown[];
    favoriteUserIds?: unknown[];
    excludedFavoriteUserIds?: unknown[];
    dateFrom?: string;
    dateTo?: string;
    maxEntries?: number;
    cursor?: FeedCursor | null;
}

export interface FeedReadModelQueryOptions extends FeedQueryOptions {
    liveEntries?: unknown[];
    minLiveSequence?: number;
    favoritesOnly?: boolean;
    maxRows?: number;
}

export interface FeedLiveRowsMergeOptions extends FeedReadModelQueryOptions {
    rows?: FeedEntry[];
}

interface FeedReadyState {
    normalizedUserId: string;
    maxTableSize: number;
    searchLimit: number;
}

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeFilterList(filters: unknown[] = []): FeedFilterType[] {
    if (!Array.isArray(filters)) {
        return [];
    }

    return filters.filter((filter, index, source): filter is FeedFilterType => {
        if (typeof filter !== 'string') {
            return false;
        }

        if (!FEED_FILTER_TYPES.includes(filter as FeedFilterType)) {
            return false;
        }

        return source.indexOf(filter) === index;
    });
}

class FeedRepository {
    #currentUserId: string = '';

    async #ensureReady(userId: unknown): Promise<FeedReadyState> {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId) {
            throw new Error('FeedRepository requires a current user id.');
        }

        const [maxTableSize, searchLimit] = await Promise.all([
            configRepository.getInt('maxTableSize_v2', 500),
            configRepository.getInt('searchLimit', 50000)
        ]);

        if (this.#currentUserId !== normalizedUserId) {
            await userSessionRepository.ensureUserTables(normalizedUserId);
            this.#currentUserId = normalizedUserId;
        }

        return {
            normalizedUserId,
            maxTableSize: Number(maxTableSize),
            searchLimit: Number(searchLimit)
        };
    }

    async queryFeed({
        userId,
        search = '',
        filters = [],
        favoriteUserIds = [],
        excludedFavoriteUserIds = [],
        dateFrom = '',
        dateTo = '',
        maxEntries,
        cursor = null
    }: FeedQueryOptions) {
        const { normalizedUserId, maxTableSize, searchLimit } =
            await this.#ensureReady(userId);
        const normalizedFilters = normalizeFilterList(filters);
        const normalizedFavorites = Array.from(
            new Set(
                (Array.isArray(favoriteUserIds) ? favoriteUserIds : [])
                    .map((value) => normalizeUserId(value))
                    .filter(Boolean)
            )
        );
        const normalizedExcludedFavorites = Array.from(
            new Set(
                (Array.isArray(excludedFavoriteUserIds)
                    ? excludedFavoriteUserIds
                    : []
                )
                    .map((value) => normalizeUserId(value))
                    .filter(Boolean)
            )
        );
        const normalizedSearch = String(search || '').trim();

        if (normalizedSearch || dateFrom || dateTo) {
            return feedPersistenceRepository.searchFeedDatabase(
                normalizedSearch,
                normalizedFilters,
                normalizedFavorites,
                maxEntries ?? searchLimit,
                dateFrom,
                dateTo,
                normalizedUserId,
                normalizedExcludedFavorites
            );
        }

        return feedPersistenceRepository.lookupFeedDatabase(
            normalizedUserId,
            normalizedFilters,
            normalizedFavorites,
            maxEntries ?? maxTableSize,
            cursor,
            normalizedExcludedFavorites
        );
    }

    async queryFeedPage(options: FeedQueryOptions) {
        return this.queryFeed(options);
    }

    async queryFeedReadModel({
        userId,
        search = '',
        filters = [],
        favoriteUserIds = [],
        excludedFavoriteUserIds = [],
        dateFrom = '',
        dateTo = '',
        liveEntries = [],
        minLiveSequence = 0,
        favoritesOnly = false,
        cursor = null,
        maxRows
    }: FeedReadModelQueryOptions) {
        const { normalizedUserId, maxTableSize, searchLimit } =
            await this.#ensureReady(userId);
        const normalizedFilters = normalizeFilterList(filters);
        const normalizedFavorites = Array.from(
            new Set(
                (Array.isArray(favoriteUserIds) ? favoriteUserIds : [])
                    .map((value) => normalizeUserId(value))
                    .filter(Boolean)
            )
        );
        const normalizedExcludedFavorites = Array.from(
            new Set(
                (Array.isArray(excludedFavoriteUserIds)
                    ? excludedFavoriteUserIds
                    : []
                )
                    .map((value) => normalizeUserId(value))
                    .filter(Boolean)
            )
        );
        const normalizedSearch = String(search || '').trim();
        const isSearchMode = Boolean(normalizedSearch || dateFrom || dateTo);
        const maxEntries = isSearchMode ? searchLimit : maxTableSize;

        return feedPersistenceRepository.queryFeedReadModel({
            userId: normalizedUserId,
            mode: isSearchMode ? 'search' : 'lookup',
            search: normalizedSearch,
            filters: normalizedFilters,
            vipList: favoritesOnly ? normalizedFavorites : [],
            excludedUserIds: normalizedExcludedFavorites,
            maxEntries,
            dateFrom,
            dateTo,
            cursor,
            liveEntries: Array.isArray(liveEntries)
                ? (liveEntries as never[])
                : [],
            minLiveSequence,
            favoritesOnly,
            favoriteUserIds: normalizedFavorites,
            maxRows: maxRows ?? maxEntries
        });
    }

    async mergeLiveRows({
        userId,
        rows = [],
        search = '',
        filters = [],
        favoriteUserIds = [],
        excludedFavoriteUserIds = [],
        dateFrom = '',
        dateTo = '',
        liveEntries = [],
        minLiveSequence = 0,
        favoritesOnly = false,
        maxRows
    }: FeedLiveRowsMergeOptions) {
        const normalizedUserId = normalizeUserId(userId);
        const normalizedFilters = normalizeFilterList(filters);
        const normalizedFavorites = Array.from(
            new Set(
                (Array.isArray(favoriteUserIds) ? favoriteUserIds : [])
                    .map((value) => normalizeUserId(value))
                    .filter(Boolean)
            )
        );
        const normalizedExcludedFavorites = Array.from(
            new Set(
                (Array.isArray(excludedFavoriteUserIds)
                    ? excludedFavoriteUserIds
                    : []
                )
                    .map((value) => normalizeUserId(value))
                    .filter(Boolean)
            )
        );

        return feedPersistenceRepository.mergeFeedLiveRows({
            rows,
            currentUserId: normalizedUserId,
            filters: normalizedFilters,
            excludedUserIds: normalizedExcludedFavorites,
            search: String(search || '').trim(),
            dateFrom,
            dateTo,
            liveEntries: Array.isArray(liveEntries)
                ? (liveEntries as never[])
                : [],
            minLiveSequence,
            favoritesOnly,
            favoriteUserIds: normalizedFavorites,
            maxRows
        });
    }

    async addGpsEntryForUser(userId: unknown, entry: FeedEntry) {
        return feedPersistenceRepository.addGPSToDatabaseForUser(userId, entry);
    }

    async addStatusEntryForUser(userId: unknown, entry: FeedEntry) {
        return feedPersistenceRepository.addStatusToDatabaseForUser(
            userId,
            entry
        );
    }

    async addBioEntryForUser(userId: unknown, entry: FeedEntry) {
        return feedPersistenceRepository.addBioToDatabaseForUser(userId, entry);
    }

    async addAvatarEntryForUser(userId: unknown, entry: FeedEntry) {
        return feedPersistenceRepository.addAvatarToDatabaseForUser(
            userId,
            entry
        );
    }

    async addOnlineOfflineEntryForUser(userId: unknown, entry: FeedEntry) {
        return feedPersistenceRepository.addOnlineOfflineToDatabaseForUser(
            userId,
            entry
        );
    }

    async purgeAvatarFeedData(
        userId: unknown,
        cutoffDate: string | null = null
    ) {
        return feedPersistenceRepository.purgeAvatarFeedData(
            userId,
            cutoffDate
        );
    }
}

const feedRepository = new FeedRepository();

export { FeedRepository };
export default feedRepository;
