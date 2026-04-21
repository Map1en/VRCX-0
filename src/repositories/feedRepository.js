import configRepository from './configRepository.js';
import feedLocalRepository from './feedLocalRepository.js';
import userSessionRepository from './userSessionRepository.js';

export const FEED_FILTER_TYPES = Object.freeze([
    'GPS',
    'Online',
    'Offline',
    'Status',
    'Avatar',
    'Bio'
]);

function normalizeUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeFilterList(filters = []) {
    if (!Array.isArray(filters)) {
        return [];
    }

    return filters.filter((filter, index, source) => {
        if (typeof filter !== 'string') {
            return false;
        }

        if (!FEED_FILTER_TYPES.includes(filter)) {
            return false;
        }

        return source.indexOf(filter) === index;
    });
}

class FeedRepository {
    #currentUserId = '';

    async #ensureReady(userId) {
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
            maxTableSize,
            searchLimit
        };
    }

    async queryFeed({
        userId,
        search = '',
        filters = [],
        favoriteUserIds = [],
        dateFrom = '',
        dateTo = ''
    }) {
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
        const normalizedSearch = String(search || '').trim();

        if (normalizedSearch || dateFrom || dateTo) {
            return feedLocalRepository.searchFeedDatabase(
                normalizedUserId,
                normalizedSearch,
                normalizedFilters,
                normalizedFavorites,
                searchLimit,
                dateFrom,
                dateTo
            );
        }

        return feedLocalRepository.lookupFeedDatabase(
            normalizedUserId,
            normalizedFilters,
            normalizedFavorites,
            maxTableSize
        );
    }

    async addGpsEntryForUser(userId, entry) {
        return feedLocalRepository.addGPSToDatabaseForUser(userId, entry);
    }

    async addStatusEntryForUser(userId, entry) {
        return feedLocalRepository.addStatusToDatabaseForUser(userId, entry);
    }

    async addBioEntryForUser(userId, entry) {
        return feedLocalRepository.addBioToDatabaseForUser(userId, entry);
    }

    async addAvatarEntryForUser(userId, entry) {
        return feedLocalRepository.addAvatarToDatabaseForUser(userId, entry);
    }

    async addOnlineOfflineEntryForUser(userId, entry) {
        return feedLocalRepository.addOnlineOfflineToDatabaseForUser(
            userId,
            entry
        );
    }

    async purgeAvatarFeedData(userId, cutoffDate = null) {
        return feedLocalRepository.purgeAvatarFeedData(userId, cutoffDate);
    }
}

const feedRepository = new FeedRepository();

export { FeedRepository };
export default feedRepository;
