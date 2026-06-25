import { userImage } from '@/services/entityMediaService';
import { resolveFriendPresenceLocation } from '@/shared/utils/location';

import {
    favoriteGroupType,
    normalizeFavoriteEntityId as normalizeEntityId,
    shrinkFavoriteImage as shrinkImage,
    sortFavoriteItems as sortItems
} from './favoritesItems';
import type { FavoriteGroup, FavoriteItem } from './favoritesTypes';

type FavoriteItemsByGroup = Record<string, FavoriteItem[]>;

function buildRemoteFavoriteGroups(
    kind: any,
    sourceGroups: any
): FavoriteGroup[] {
    return sourceGroups.map((group: any) => ({
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

function buildLocalFavoriteGroups(names: any, source: any): FavoriteGroup[] {
    return names.map((name: any) => ({
        source: 'local',
        key: name,
        label: name,
        count: Array.isArray(source[name]) ? source[name].length : 0,
        capacity: 0,
        visibility: ''
    }));
}

function resolveTranslator(t: any) {
    return typeof t === 'function' ? t : (key: any) => key;
}

function defaultFavoriteEntityTitle(kind: any, t: any) {
    const translate = resolveTranslator(t);
    return kind === 'world'
        ? translate('view.favorites.empty.world_fallback')
        : translate('view.favorites.empty.avatar_fallback');
}

function defaultFavoriteDetailSubtitle(kind: any, isUnavailable: any, t: any) {
    const translate = resolveTranslator(t);
    if (kind === 'world') {
        return isUnavailable
            ? translate('view.favorites.error.world_details_unavailable')
            : translate('view.favorites.loading.loading_world_details');
    }

    return isUnavailable
        ? translate('view.favorites.error.avatar_details_unavailable')
        : translate('view.favorites.loading.loading_avatar_details');
}

function resolveFavoriteSubtitle(friend: any, location: any) {
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
    knownUser,
    index,
    favoritesSortIndex,
    t
}: any): FavoriteItem {
    const translate = resolveTranslator(t);
    const normalizedId = normalizeEntityId(friendId);
    const profile = friend
        ? {
              ...(knownUser || {}),
              ...friend,
              displayName: friend.displayName || knownUser?.displayName,
              username: friend.username || knownUser?.username
          }
        : knownUser || null;
    const status = profile?.stateBucket || profile?.state || 'offline';
    const location = resolveFavoritePresenceLocation(profile);

    return {
        key: `${source}:${groupKey}:${normalizedId}`,
        kind,
        source,
        groupKey,
        groupLabel,
        id: normalizedId,
        title:
            profile?.displayName ||
            profile?.username ||
            translate('view.favorites.empty.user_fallback'),
        titleColor: profile?.$userColour || '',
        subtitle: resolveFavoriteSubtitle(profile, location),
        detailText: '',
        location,
        travelingToLocation: profile?.travelingToLocation || '',
        imageUrl: profile ? userImage(profile, true) : '',
        statusLabel: status,
        statusVariant:
            status === 'online' || status === 'active'
                ? 'default'
                : 'secondary',
        seedData: profile,
        orderIndex: favoritesSortIndex?.[normalizedId] ?? index
    };
}

export function resolveFavoritePresenceLocation(profile: any) {
    return resolveFriendPresenceLocation(profile);
}

export function getFavoritesPageConfig(kind: any, t: any) {
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
    const localNewGroupLabel =
        kind === 'avatar'
            ? translate('view.favorite.avatars.new_group')
            : kind === 'world'
              ? translate('view.favorite.worlds.new_group')
              : translate('view.favorite.worlds.new_group');

    return {
        remoteSectionTitle,
        localSectionTitle,
        localNewGroupLabel,
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
}: any): FavoriteGroup[] {
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
}: any): FavoriteGroup[] {
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
}: any): FavoriteGroup[] {
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

export function buildFavoriteGroupLabelByKey(groups: any) {
    return Object.fromEntries(
        groups.map((group: any) => [group.key, group.label])
    );
}

export function buildFavoriteRemoteItemsByGroup({
    kind,
    remoteGroups,
    groupedFavoriteFriendIdsByGroupKey,
    friendsById,
    knownUsersById = {},
    favoritesSortIndex,
    sortValue,
    remoteFavoritesById,
    remoteEntityDetailsData,
    remoteEntityDetailsStatus,
    localWorldDetailsById = {},
    remoteGroupLabelByKey,
    t
}: any): FavoriteItemsByGroup {
    const translate = resolveTranslator(t);
    const itemsByGroup: FavoriteItemsByGroup = Object.create(null);
    for (const group of remoteGroups) {
        itemsByGroup[group.key] = [];
    }

    if (kind === 'friend') {
        for (const group of remoteGroups) {
            const ids = groupedFavoriteFriendIdsByGroupKey[group.key] || [];
            const items = ids.map((friendId: any, index: any) =>
                buildFriendFavoriteItem({
                    kind,
                    source: 'remote',
                    groupKey: group.key,
                    groupLabel: group.label,
                    friendId,
                    friend: friendsById[normalizeEntityId(friendId)],
                    knownUser: knownUsersById[normalizeEntityId(friendId)],
                    index,
                    favoritesSortIndex,
                    t: translate
                })
            );
            itemsByGroup[group.key] = sortItems(items, sortValue);
        }

        return itemsByGroup;
    }

    const remoteFavorites = Object.values(remoteFavoritesById)
        .filter((favorite): favorite is Record<string, unknown> =>
            Boolean(favorite && typeof favorite === 'object')
        )
        .filter((favorite) =>
            kind === 'avatar'
                ? favorite.type === 'avatar'
                : favorite.type === 'world' || favorite.type === 'vrcPlusWorld'
        );

    for (const favorite of remoteFavorites) {
        const favoriteId = normalizeEntityId(favorite.favoriteId);
        const groupKey = String(favorite.$groupKey || '');
        if (!favoriteId || !groupKey || !itemsByGroup[groupKey]) {
            continue;
        }

        const detail = remoteEntityDetailsData[favoriteId];
        const cachedWorldDetail =
            kind === 'world' ? localWorldDetailsById[favoriteId] : null;
        const displayDetail = detail || cachedWorldDetail;
        const isUnavailable = remoteEntityDetailsStatus === 'ready' && !detail;
        const playerCount = Number(displayDetail?.occupants) || 0;
        const subtitle =
            kind === 'world'
                ? displayDetail?.authorName
                    ? playerCount
                        ? `${displayDetail.authorName} (${playerCount})`
                        : displayDetail.authorName
                    : defaultFavoriteDetailSubtitle(
                          kind,
                          isUnavailable,
                          translate
                      )
                : displayDetail?.authorName ||
                  defaultFavoriteDetailSubtitle(kind, isUnavailable, translate);

        itemsByGroup[groupKey].push({
            key: `remote:${groupKey}:${favoriteId}`,
            kind,
            source: 'remote',
            groupKey,
            groupLabel:
                remoteGroupLabelByKey[groupKey] ||
                translate('view.favorites.empty.favorites_fallback'),
            id: favoriteId,
            title:
                displayDetail?.name ||
                defaultFavoriteEntityTitle(kind, translate),
            subtitle,
            description: displayDetail?.description || '',
            seedData: detail || cachedWorldDetail || null,
            imageUrl: shrinkImage(
                displayDetail?.thumbnailImageUrl ||
                    displayDetail?.imageUrl ||
                    ''
            ),
            isPrivate: displayDetail?.releaseStatus === 'private',
            isUnavailable,
            tags: displayDetail?.tags || [],
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
    knownUsersById = {},
    sortValue,
    t
}: any): FavoriteItemsByGroup {
    const translate = resolveTranslator(t);
    const itemsByGroup: FavoriteItemsByGroup = Object.create(null);

    if (kind === 'friend') {
        for (const group of localGroups) {
            const ids = Array.isArray(localFriendFavorites[group.key])
                ? localFriendFavorites[group.key]
                : [];
            const items = ids.map((friendId: any, index: any) =>
                buildFriendFavoriteItem({
                    kind,
                    source: 'local',
                    groupKey: group.key,
                    groupLabel: group.label,
                    friendId,
                    friend: friendsById[normalizeEntityId(friendId)],
                    knownUser: knownUsersById[normalizeEntityId(friendId)],
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
        const items = ids.map((entityId: any, index: any) => {
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
                title:
                    detail.name || defaultFavoriteEntityTitle(kind, translate),
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

export function buildFavoriteAvatarHistoryItems({
    kind,
    avatarHistory,
    t
}: any): FavoriteItem[] {
    if (kind !== 'avatar') {
        return [];
    }

    const translate = resolveTranslator(t);
    const groupLabel = translate('view.favorite.avatars.local_history');

    return avatarHistory.map((detail: any, index: any) => {
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
                translate('view.favorites.empty.avatar_fallback'),
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
