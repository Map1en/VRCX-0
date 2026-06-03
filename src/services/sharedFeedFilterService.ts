import { onPreferenceChanged } from '@/shared/events/preferenceEvents';
import configRepository from '@/repositories/configRepository';
import i18n from '@/services/i18nService';
import {
    sharedFeedFiltersDefaults,
    type SharedFeedFilterDefaults
} from '@/shared/constants/feedFilters';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useNotificationStore } from '@/state/notificationStore';

type SharedFeedMode = keyof SharedFeedFilterDefaults;
type SharedFeedFilters = {
    noty: Record<string, unknown>;
};
type SharedFeedEntry = Record<string, unknown> & {
    type?: unknown;
    userId?: unknown;
    senderUserId?: unknown;
    displayName?: unknown;
    worldName?: unknown;
    avatarName?: unknown;
    videoName?: unknown;
    notyName?: unknown;
    message?: unknown;
    status?: unknown;
    statusDescription?: unknown;
};
type SharedFeedFilterContext = {
    friend: boolean;
    favorite: boolean;
};

const FEED_FILTER_KEY_BY_TYPE = Object.freeze({
    Avatar: 'AvatarChange'
}) satisfies Record<string, string>;

let cachedSharedFeedFilters: SharedFeedFilters = normalizeSharedFeedFilters();
let sharedFeedFiltersLoaded = false;
let sharedFeedFiltersLoadPromise: Promise<SharedFeedFilters> | null = null;
let unsubscribeSharedFeedFilters: (() => void) | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeSharedFeedFilters(value?: unknown): SharedFeedFilters {
    const record = isRecord(value) ? value : {};
    const noty = isRecord(record.noty) ? record.noty : {};
    return {
        noty: {
            ...sharedFeedFiltersDefaults.noty,
            ...noty
        }
    };
}

function parseSharedFeedFilters(value: unknown): SharedFeedFilters {
    if (!value) {
        return normalizeSharedFeedFilters();
    }
    if (value && typeof value === 'object') {
        return normalizeSharedFeedFilters(value);
    }
    try {
        return normalizeSharedFeedFilters(JSON.parse(value as string));
    } catch {
        return normalizeSharedFeedFilters();
    }
}

function initSharedFeedFilterSubscription(): void {
    if (unsubscribeSharedFeedFilters) {
        return;
    }
    unsubscribeSharedFeedFilters = onPreferenceChanged(
        'sharedFeedFilters',
        (value: any) => {
            cachedSharedFeedFilters = parseSharedFeedFilters(value);
            sharedFeedFiltersLoaded = true;
            sharedFeedFiltersLoadPromise = null;
        }
    );
}

async function loadSharedFeedFilters(): Promise<SharedFeedFilters> {
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
            .then((value: any) => {
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

function normalizeId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getEntryUserId(entry?: SharedFeedEntry | null): string {
    return normalizeId(entry?.userId || entry?.senderUserId);
}

function isLocalFavoriteFriend(userId: unknown): boolean {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return false;
    }
    const localFriendFavorites =
        useFavoriteStore.getState().localFriendFavorites;
    return Object.values(localFriendFavorites ?? {}).some(
        (ids: any) =>
            Array.isArray(ids) &&
            ids.some((id: any) => normalizeId(id) === normalizedUserId)
    );
}

function isFriend(userId: unknown): boolean {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return false;
    }
    return Boolean(
        useFriendRosterStore.getState().friendsById?.[normalizedUserId]
    );
}

function getFeedFilterKey(type: unknown): string {
    const normalizedType = normalizeId(type);
    return FEED_FILTER_KEY_BY_TYPE[normalizedType] || normalizedType;
}

function shouldShowForFilterValue(
    value: unknown,
    { friend, favorite }: SharedFeedFilterContext
): boolean {
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

export async function shouldIncludeSharedFeedEntry(
    entry?: SharedFeedEntry | null,
    mode: SharedFeedMode = 'noty'
): Promise<boolean> {
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

export async function pushSharedFeedNotification(
    entry?: SharedFeedEntry | null
): Promise<void> {
    if (!(await shouldIncludeSharedFeedEntry(entry, 'noty'))) {
        return;
    }
    const type = normalizeId(entry?.type) || 'Feed';
    const displayName =
        normalizeId(entry?.displayName || entry?.userId) || 'Unknown';
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
        title: i18n.t(
            'service.shared_feed_filter_service.dynamic.feed_value',
            { value: type }
        ),
        message: [displayName, detail].filter(Boolean).join(' - ')
    });
}

export { normalizeSharedFeedFilters };
