import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import { configRepository } from '@/repositories/index.js';
import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import i18n from '@/services/i18nService.js';

const FEED_FILTER_KEY_BY_TYPE = Object.freeze({
    Avatar: 'AvatarChange'
});

let cachedSharedFeedFilters = normalizeSharedFeedFilters();
let sharedFeedFiltersLoaded = false;
let sharedFeedFiltersLoadPromise = null;
let unsubscribeSharedFeedFilters = null;

function normalizeSharedFeedFilters(value) {
    return {
        noty: {
            ...sharedFeedFiltersDefaults.noty,
            ...(value?.noty && typeof value.noty === 'object' ? value.noty : {})
        },
        wrist: {
            ...sharedFeedFiltersDefaults.wrist,
            ...(value?.wrist && typeof value.wrist === 'object'
                ? value.wrist
                : {})
        }
    };
}

function parseSharedFeedFilters(value) {
    if (!value) {
        return normalizeSharedFeedFilters();
    }
    if (value && typeof value === 'object') {
        return normalizeSharedFeedFilters(value);
    }
    try {
        return normalizeSharedFeedFilters(JSON.parse(value));
    } catch {
        return normalizeSharedFeedFilters();
    }
}

function initSharedFeedFilterSubscription() {
    if (unsubscribeSharedFeedFilters) {
        return;
    }
    unsubscribeSharedFeedFilters = onPreferenceChanged(
        'sharedFeedFilters',
        (value) => {
            cachedSharedFeedFilters = parseSharedFeedFilters(value);
            sharedFeedFiltersLoaded = true;
            sharedFeedFiltersLoadPromise = null;
        }
    );
}

async function loadSharedFeedFilters() {
    initSharedFeedFilterSubscription();
    if (sharedFeedFiltersLoaded) {
        return cachedSharedFeedFilters;
    }
    if (!sharedFeedFiltersLoadPromise) {
        sharedFeedFiltersLoadPromise = configRepository
            .getString(
                'sharedFeedFilters',
                JSON.stringify(sharedFeedFiltersDefaults)
            )
            .then((value) => {
                cachedSharedFeedFilters = parseSharedFeedFilters(value);
                sharedFeedFiltersLoaded = true;
                sharedFeedFiltersLoadPromise = null;
                return cachedSharedFeedFilters;
            })
            .catch(() => {
                cachedSharedFeedFilters = normalizeSharedFeedFilters();
                sharedFeedFiltersLoaded = true;
                sharedFeedFiltersLoadPromise = null;
                return cachedSharedFeedFilters;
            });
    }
    return sharedFeedFiltersLoadPromise;
}

function normalizeId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getEntryUserId(entry) {
    return normalizeId(entry?.userId || entry?.senderUserId);
}

function isLocalFavoriteFriend(userId) {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return false;
    }
    const localFriendFavorites =
        useFavoriteStore.getState().localFriendFavorites;
    return Object.values(localFriendFavorites ?? {}).some(
        (ids) =>
            Array.isArray(ids) &&
            ids.some((id) => normalizeId(id) === normalizedUserId)
    );
}

function isFriend(userId) {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return false;
    }
    return Boolean(
        useFriendRosterStore.getState().friendsById?.[normalizedUserId]
    );
}

function getFeedFilterKey(type) {
    return FEED_FILTER_KEY_BY_TYPE[type] || type || '';
}

function shouldShowForFilterValue(value, { friend, favorite }) {
    switch (value) {
        case 'On':
        case 'Everyone':
            return true;
        case 'Friends':
            return friend;
        case 'VIP':
            return favorite;
        default:
            return false;
    }
}

export async function shouldIncludeSharedFeedEntry(entry, mode = 'noty') {
    const filters = await loadSharedFeedFilters();
    const filterKey = getFeedFilterKey(entry?.type);
    const filterValue =
        filters?.[mode]?.[filterKey] ||
        sharedFeedFiltersDefaults?.[mode]?.[filterKey] ||
        'Off';
    const userId = getEntryUserId(entry);
    return shouldShowForFilterValue(filterValue, {
        friend: isFriend(userId),
        favorite: isLocalFavoriteFriend(userId)
    });
}

export async function pushSharedFeedNotification(entry) {
    if (!(await shouldIncludeSharedFeedEntry(entry, 'noty'))) {
        return;
    }
    const type = entry?.type || 'Feed';
    const displayName = entry?.displayName || entry?.userId || 'Unknown';
    const detail =
        entry?.worldName ||
        entry?.avatarName ||
        entry?.videoName ||
        entry?.notyName ||
        entry?.message ||
        entry?.status ||
        entry?.statusDescription ||
        '';
    useNotificationStore.getState().pushNotification({
        level: 'info',
        title: i18n.t('service.shared_feed_filter_service.generated_dynamic.feed_value', { value: type }),
        message: [displayName, detail].filter(Boolean).join(' - ')
    });
}

export { normalizeSharedFeedFilters };
