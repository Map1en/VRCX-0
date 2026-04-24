import { userImage } from '@/lib/entityMedia.js';
import { resolveFriendPresenceLocation } from '@/shared/utils/location.js';

import {
    favoriteGroupType,
    normalizeFavoriteEntityId as normalizeEntityId,
    shrinkFavoriteImage as shrinkImage,
    sortFavoriteItems as sortItems
} from './favoritesItems.js';

function buildRemoteFavoriteGroups(kind, sourceGroups) {
    return sourceGroups.map((group) => ({
        source: 'remote',
        key: group.key,
        name:
            group.name ||
            String(group.key || '')
                .split(':')
                .pop() ||
            '',
        type: group.type || favoriteGroupType(kind, group),
        label: group.displayName || group.name || group.key,
        count: Number(group.count) || 0,
        capacity: Number(group.capacity) || 0,
        visibility: group.visibility || ''
    }));
}

function buildLocalFavoriteGroups(names, source) {
    return names.map((name) => ({
        source: 'local',
        key: name,
        label: name,
        count: Array.isArray(source[name]) ? source[name].length : 0,
        capacity: 0,
        visibility: ''
    }));
}

function resolveTranslator(t) {
    return typeof t === 'function' ? t : (key) => key;
}

function defaultFavoriteEntityTitle(kind, t) {
    const translate = resolveTranslator(t);
    return kind === 'world'
        ? translate('view.favorites.generated.world_fallback')
        : translate('view.favorites.generated.avatar_fallback');
}

function defaultFavoriteDetailSubtitle(kind, isUnavailable, t) {
    const translate = resolveTranslator(t);
    if (kind === 'world') {
        return isUnavailable
            ? translate('view.favorites.generated.world_details_unavailable')
            : translate('view.favorites.generated.loading_world_details');
    }

    return isUnavailable
        ? translate('view.favorites.generated.avatar_details_unavailable')
        : translate('view.favorites.generated.loading_avatar_details');
}

function resolveFavoriteSubtitle(friend, location) {
    if (!friend) {
        return '';
    }
    return location && location !== 'offline'
        ? location
        : friend?.statusDescription || '';
}

function buildFriendFavoriteItem({
    kind,
    source,
    groupKey,
    groupLabel,
    friendId,
    friend,
    index,
    favoritesSortIndex,
    t
}) {
    const translate = resolveTranslator(t);
    const normalizedId = normalizeEntityId(friendId);
    const status = friend?.stateBucket || friend?.state || 'offline';
    const location = resolveFavoritePresenceLocation(friend);

    return {
        key: `${source}:${groupKey}:${normalizedId}`,
        kind,
        source,
        groupKey,
        groupLabel,
        id: normalizedId,
        title:
            friend?.displayName ||
            friend?.username ||
            translate('view.favorites.generated.user_fallback'),
        titleColor: friend?.$userColour || '',
        subtitle: resolveFavoriteSubtitle(friend, location),
        detailText: '',
        location,
        travelingToLocation: friend?.travelingToLocation || '',
        imageUrl: friend ? userImage(friend, true) : '',
        statusLabel: status,
        statusVariant:
            status === 'online' || status === 'active'
                ? 'default'
                : 'secondary',
        seedData: friend || null,
        orderIndex: favoritesSortIndex?.[normalizedId] ?? index
    };
}

export function resolveFavoritePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

export function getFavoritesPageConfig(kind, t) {
    const translate = resolveTranslator(t);
    const remoteSectionTitle =
        kind === 'avatar'
            ? translate('view.favorite.avatars.vrchat_favorites')
            : kind === 'world'
              ? translate('view.favorite.worlds.vrchat_favorites')
              : translate('dialog.favorite.vrchat_favorites');
    const localSectionTitle =
        kind === 'avatar'
            ? translate('view.favorite.avatars.local_favorites')
            : kind === 'world'
              ? translate('view.favorite.worlds.local_favorites')
              : translate('dialog.favorite.local_favorites');

    return {
        remoteSectionTitle,
        localSectionTitle,
        searchPlaceholder:
            kind === 'avatar'
                ? translate('view.favorite.avatars.search')
                : kind === 'world'
                  ? translate('view.favorite.worlds.search')
                  : translate('common.actions.search')
    };
}

export function buildFavoriteRemoteGroups({
    kind,
    favoriteFriendGroups,
    favoriteAvatarGroups,
    favoriteWorldGroups
}) {
    const sourceGroups =
        kind === 'friend'
            ? favoriteFriendGroups
            : kind === 'avatar'
              ? favoriteAvatarGroups
              : favoriteWorldGroups;

    return buildRemoteFavoriteGroups(kind, sourceGroups);
}

export function buildFavoriteLocalGroups({
    kind,
    localFriendFavoriteGroups,
    localAvatarFavoriteGroups,
    localWorldFavoriteGroups,
    localFriendFavorites,
    localAvatarFavorites,
    localWorldFavorites
}) {
    const names =
        kind === 'friend'
            ? localFriendFavoriteGroups
            : kind === 'avatar'
              ? localAvatarFavoriteGroups
              : localWorldFavoriteGroups;
    const source =
        kind === 'friend'
            ? localFriendFavorites
            : kind === 'avatar'
              ? localAvatarFavorites
              : localWorldFavorites;

    return buildLocalFavoriteGroups(names, source);
}

export function buildFavoriteAvatarHistoryGroups({
    kind,
    avatarHistoryLength,
    t
}) {
    if (kind !== 'avatar') {
        return [];
    }
    const translate = resolveTranslator(t);

    return [
        {
            source: 'history',
            key: 'local-history',
            label: translate('view.favorite.avatars.local_history'),
            count: avatarHistoryLength,
            capacity: 100,
            visibility: ''
        }
    ];
}

export function buildFavoriteGroupLabelByKey(groups) {
    return Object.fromEntries(groups.map((group) => [group.key, group.label]));
}

export function buildFavoriteRemoteItemsByGroup({
    kind,
    remoteGroups,
    groupedFavoriteFriendIdsByGroupKey,
    friendsById,
    favoritesSortIndex,
    sortValue,
    remoteFavoritesById,
    remoteEntityDetailsData,
    remoteEntityDetailsStatus,
    remoteGroupLabelByKey,
    t
}) {
    const translate = resolveTranslator(t);
    const itemsByGroup = Object.create(null);
    for (const group of remoteGroups) {
        itemsByGroup[group.key] = [];
    }

    if (kind === 'friend') {
        for (const group of remoteGroups) {
            const ids = groupedFavoriteFriendIdsByGroupKey[group.key] || [];
            const items = ids.map((friendId, index) =>
                buildFriendFavoriteItem({
                    kind,
                    source: 'remote',
                    groupKey: group.key,
                    groupLabel: group.label,
                    friendId,
                    friend: friendsById[normalizeEntityId(friendId)],
                    index,
                    favoritesSortIndex,
                    t: translate
                })
            );
            itemsByGroup[group.key] = sortItems(items, sortValue);
        }

        return itemsByGroup;
    }

    const remoteFavorites = Object.values(remoteFavoritesById).filter(
        (favorite) =>
            kind === 'avatar'
                ? favorite?.type === 'avatar'
                : favorite?.type === 'world' ||
                  favorite?.type === 'vrcPlusWorld'
    );

    for (const favorite of remoteFavorites) {
        const favoriteId = normalizeEntityId(favorite.favoriteId);
        const groupKey = favorite.$groupKey;
        if (!favoriteId || !groupKey || !itemsByGroup[groupKey]) {
            continue;
        }

        const detail = remoteEntityDetailsData[favoriteId];
        const isUnavailable =
            remoteEntityDetailsStatus === 'ready' && !detail;
        const playerCount = Number(detail?.occupants) || 0;
        const subtitle =
            kind === 'world'
                ? detail?.authorName
                    ? playerCount
                        ? `${detail.authorName} (${playerCount})`
                        : detail.authorName
                    : defaultFavoriteDetailSubtitle(kind, isUnavailable, translate)
                : detail?.authorName ||
                  defaultFavoriteDetailSubtitle(kind, isUnavailable, translate);

        itemsByGroup[groupKey].push({
            key: `remote:${groupKey}:${favoriteId}`,
            kind,
            source: 'remote',
            groupKey,
            groupLabel:
                remoteGroupLabelByKey[groupKey] ||
                translate('view.favorites.generated.favorites_fallback'),
            id: favoriteId,
            title: detail?.name || defaultFavoriteEntityTitle(kind, translate),
            subtitle,
            description: detail?.description || '',
            seedData: detail || null,
            imageUrl: shrinkImage(
                detail?.thumbnailImageUrl || detail?.imageUrl || ''
            ),
            isPrivate: detail?.releaseStatus === 'private',
            isUnavailable,
            tags: detail?.tags || [],
            playerCount,
            orderIndex:
                favoritesSortIndex[favoriteId] ?? Number.MAX_SAFE_INTEGER
        });
    }

    for (const group of remoteGroups) {
        itemsByGroup[group.key] = sortItems(
            itemsByGroup[group.key] || [],
            sortValue
        );
    }

    return itemsByGroup;
}

export function buildFavoriteLocalItemsByGroup({
    kind,
    localGroups,
    localFriendFavorites,
    localAvatarFavorites,
    localWorldFavorites,
    localAvatarDetailsById,
    localWorldDetailsById,
    friendsById,
    sortValue,
    t
}) {
    const translate = resolveTranslator(t);
    const itemsByGroup = Object.create(null);

    if (kind === 'friend') {
        for (const group of localGroups) {
            const ids = Array.isArray(localFriendFavorites[group.key])
                ? localFriendFavorites[group.key]
                : [];
            const items = ids.map((friendId, index) =>
                buildFriendFavoriteItem({
                    kind,
                    source: 'local',
                    groupKey: group.key,
                    groupLabel: group.label,
                    friendId,
                    friend: friendsById[normalizeEntityId(friendId)],
                    index,
                    t: translate
                })
            );
            itemsByGroup[group.key] = sortItems(items, sortValue);
        }

        return itemsByGroup;
    }

    const localFavorites =
        kind === 'avatar' ? localAvatarFavorites : localWorldFavorites;
    const localDetailsById =
        kind === 'avatar' ? localAvatarDetailsById : localWorldDetailsById;

    for (const group of localGroups) {
        const ids = Array.isArray(localFavorites[group.key])
            ? localFavorites[group.key]
            : [];
        const items = ids.map((entityId, index) => {
            const normalizedId = normalizeEntityId(entityId);
            const detail = localDetailsById[normalizedId] || {
                id: normalizedId
            };
            const playerCount = Number(detail.occupants) || 0;
            return {
                key: `local:${group.key}:${normalizedId}`,
                kind,
                source: 'local',
                groupKey: group.key,
                groupLabel: group.label,
                id: normalizedId,
                title: detail.name || defaultFavoriteEntityTitle(kind, translate),
                subtitle: detail.authorName || '',
                description: detail.description || '',
                seedData: detail || null,
                imageUrl: shrinkImage(
                    detail.thumbnailImageUrl || detail.imageUrl || ''
                ),
                isPrivate: detail.releaseStatus === 'private',
                isUnavailable: false,
                tags: detail.tags || [],
                playerCount,
                orderIndex: index
            };
        });
        itemsByGroup[group.key] = sortItems(items, sortValue);
    }

    return itemsByGroup;
}

export function buildFavoriteAvatarHistoryItems({ kind, avatarHistory, t }) {
    if (kind !== 'avatar') {
        return [];
    }

    const translate = resolveTranslator(t);
    const groupLabel = translate('view.favorite.avatars.local_history');

    return avatarHistory.map((detail, index) => {
        const normalizedId = normalizeEntityId(detail?.id);
        return {
            key: `history:local-history:${normalizedId || index}`,
            kind: 'avatar',
            source: 'history',
            groupKey: 'local-history',
            groupLabel,
            id: normalizedId,
            title:
                detail?.name ||
                translate('view.favorites.generated.avatar_fallback'),
            subtitle: detail?.authorName || '',
            description: detail?.description || '',
            seedData: detail || null,
            imageUrl: shrinkImage(
                detail?.thumbnailImageUrl || detail?.imageUrl || ''
            ),
            isPrivate: detail?.releaseStatus === 'private',
            isUnavailable: false,
            tags: detail?.tags || [],
            playerCount: 0,
            orderIndex: index
        };
    });
}
