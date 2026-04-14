import { database } from '@/services/database/index.js';

import configRepository from './configRepository.js';

export const FEED_FILTER_TYPES = Object.freeze(['GPS', 'Online', 'Offline', 'Status', 'Avatar', 'Bio']);

function normalizeUserId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
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

        database.setMaxTableSize(maxTableSize);
        database.setSearchTableSize(searchLimit);

        if (this.#currentUserId !== normalizedUserId) {
            await database.initUserTables(normalizedUserId);
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
        const { maxTableSize, searchLimit } = await this.#ensureReady(userId);
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
            return database.searchFeedDatabase(
                normalizedSearch,
                normalizedFilters,
                normalizedFavorites,
                searchLimit,
                dateFrom,
                dateTo
            );
        }

        return database.lookupFeedDatabase(normalizedFilters, normalizedFavorites, maxTableSize);
    }
}

const feedRepository = new FeedRepository();

export { FeedRepository };
export default feedRepository;
