import { userImage } from '@/services/entityMediaService';
import { resolveFriendPresenceLocation } from '@/shared/utils/location';

import { hasDisplayableEntityDetail } from './favoriteEntityDetails';
import {
    favoriteGroupType,
    normalizeFavoriteEntityId as normalizeEntityId,
    resolveFavoriteImage,
    shrinkFavoriteImage as shrinkImage,
    sortFavoriteItems as sortItems
} from './favoritesItems';
import type {
    FavoriteGroup,
    FavoriteItem,
    FavoriteKind,
    FavoriteSeedData
} from './favoritesTypes';

type FavoriteItemsByGroup = Record<string, FavoriteItem[]>;
type TranslateFn = (key: string) => string;
type FavoriteGroupRecord = Record<string, unknown> & {
    capacity?: unknown;
    count?: unknown;
    displayName?: unknown;
    key?: unknown;
    name?: unknown;
    type?: unknown;
    visibility?: unknown;
};
type FavoriteGroupInput = Record<string, unknown> & {
    key: string;
    label: string;
};
export type FavoriteEntityDetail = Record<string, unknown> & {
    authorName?: unknown;
    description?: unknown;
    imageUrl?: unknown;
    name?: unknown;
    occupants?: unknown;
    releaseStatus?: unknown;
    tags?: unknown;
    thumbnailImageUrl?: unknown;
};
type FavoriteRecord = Record<string, unknown> & {
    $groupKey?: unknown;
    favoriteId?: unknown;
    type?: unknown;
};
type FavoriteProfileRecord = Record<string, unknown> & {
    $userColour?: unknown;
    displayName?: unknown;
    isFriend?: unknown;
    state?: unknown;
    stateBucket?: unknown;
    statusDescription?: unknown;
    travelingToLocation?: unknown;
    username?: unknown;
};
type FavoriteGroupSourceMap = Record<string, unknown[]>;
type FavoriteDetailMap = Record<string, FavoriteEntityDetail | undefined>;
type FavoriteProfileMap = Record<string, FavoriteProfileRecord | undefined>;
type FavoriteSortIndex = Record<string, number | undefined>;
type FavoriteSortValue = unknown;

function textValue(value: unknown) {
    return typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : String(value);
}

function favoriteSeedData(
    value: Record<string, unknown> | null | undefined
): FavoriteSeedData | null {
    if (!value) {
        return null;
    }
    return {
        ...value,
        displayName: textValue(value.displayName) || undefined,
        groupName: textValue(value.groupName) || undefined,
        id: textValue(value.id) || undefined,
        releaseStatus: textValue(value.releaseStatus) || undefined,
        state: textValue(value.state) || undefined,
        stateBucket: textValue(value.stateBucket) || undefined,
        status:
            value.status === null ? null : textValue(value.status) || undefined,
        travelingToWorld: textValue(value.travelingToWorld) || undefined,
        worldName: textValue(value.worldName) || undefined
    };
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(textValue).filter(Boolean) : [];
}

function firstDisplayableDetail(candidates: unknown[]) {
    return candidates.find((candidate) =>
        hasDisplayableEntityDetail(candidate)
    ) as FavoriteEntityDetail | undefined;
}

function favoriteImagePair(detail: FavoriteEntityDetail | null | undefined) {
    const largeImageUrl = resolveFavoriteImage(detail?.imageUrl);
    const thumbnailImageUrl = resolveFavoriteImage(detail?.thumbnailImageUrl);
    return {
        imageUrl: largeImageUrl || thumbnailImageUrl,
        imageSmallUrl: shrinkImage(thumbnailImageUrl || largeImageUrl)
    };
}

function buildRemoteFavoriteGroups(
    kind: FavoriteKind,
    sourceGroups: readonly FavoriteGroupRecord[]
): FavoriteGroup[] {
    return sourceGroups.map((group) => {
        const key = textValue(group.key);
        const name =
            textValue(group.name) ||
            String(key || '')
                .split(':')
                .pop() ||
            '';
        return {
            source: 'remote',
            key,
            name,
            type: textValue(group.type) || favoriteGroupType(kind, group),
            label: textValue(group.displayName || group.name || group.key),
            count: Number(group.count) || 0,
            capacity: Number(group.capacity) || 0,
            visibility: textValue(group.visibility)
        };
    });
}

function buildLocalFavoriteGroups(
    names: readonly string[],
    source: FavoriteGroupSourceMap
): FavoriteGroup[] {
    return names.map((name) => ({
        source: 'local',
        key: name,
        label: name,
        count: Array.isArray(source[name]) ? source[name].length : 0,
        visibility: ''
    }));
}

function resolveTranslator(t: unknown): TranslateFn {
    return typeof t === 'function' ? (t as TranslateFn) : (key) => key;
}

function defaultFavoriteEntityTitle(kind: FavoriteKind, t: unknown) {
    const translate = resolveTranslator(t);
    return kind === 'world'
        ? translate('view.favorites.empty.world_fallback')
        : translate('view.favorites.empty.avatar_fallback');
}

function defaultFavoriteDetailSubtitle(
    kind: FavoriteKind,
    isUnavailable: boolean,
    t: unknown,
    isDeleted = false
) {
    const translate = resolveTranslator(t);
    if (kind === 'world') {
        if (isUnavailable) {
            return isDeleted
                ? translate('view.favorites.error.world_deleted')
                : translate('view.favorites.error.world_details_unavailable');
        }
        return translate('view.favorites.loading.loading_world_details');
    }

    return isUnavailable
        ? translate('view.favorites.error.avatar_details_unavailable')
        : translate('view.favorites.loading.loading_avatar_details');
}

function resolveFavoriteSubtitle(
    friend: FavoriteProfileRecord | null | undefined,
    location: string
) {
    if (!friend) {
        return '';
    }
    return location && location !== 'offline'
        ? location
        : textValue(friend?.statusDescription);
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
}: {
    kind: FavoriteKind;
    source: 'remote' | 'local';
    groupKey: string;
    groupLabel: string;
    friendId: unknown;
    friend?: FavoriteProfileRecord | null;
    knownUser?: FavoriteProfileRecord | null;
    index: number;
    favoritesSortIndex?: FavoriteSortIndex;
    t: TranslateFn;
}): FavoriteItem {
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
            textValue(profile?.displayName || profile?.username) ||
            translate('view.favorites.empty.user_fallback'),
        titleColor: textValue(profile?.$userColour),
        subtitle: resolveFavoriteSubtitle(profile, location),
        detailText: '',
        location,
        travelingToLocation: textValue(profile?.travelingToLocation),
        imageUrl: profile ? userImage(profile, true, '64') : '',
        statusLabel: textValue(status),
        statusVariant:
            status === 'online' || status === 'active'
                ? 'default'
                : 'secondary',
        seedData: favoriteSeedData(profile),
        orderIndex: favoritesSortIndex?.[normalizedId] ?? index
    };
}

export function resolveFavoritePresenceLocation(profile: unknown) {
    return resolveFriendPresenceLocation(profile);
}

export function getFavoritesPageConfig(kind: FavoriteKind, t: unknown) {
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
}: {
    kind: FavoriteKind;
    favoriteFriendGroups?: readonly FavoriteGroupRecord[];
    favoriteAvatarGroups?: readonly FavoriteGroupRecord[];
    favoriteWorldGroups?: readonly FavoriteGroupRecord[];
}): FavoriteGroup[] {
    const sourceGroups =
        kind === 'friend'
            ? favoriteFriendGroups
            : kind === 'avatar'
              ? favoriteAvatarGroups
              : favoriteWorldGroups;

    return buildRemoteFavoriteGroups(kind, sourceGroups || []);
}

export function buildFavoriteLocalGroups({
    kind,
    localFriendFavoriteGroups,
    localAvatarFavoriteGroups,
    localWorldFavoriteGroups,
    localFriendFavorites,
    localAvatarFavorites,
    localWorldFavorites
}: {
    kind: FavoriteKind;
    localFriendFavoriteGroups?: readonly string[];
    localAvatarFavoriteGroups?: readonly string[];
    localWorldFavoriteGroups?: readonly string[];
    localFriendFavorites?: FavoriteGroupSourceMap;
    localAvatarFavorites?: FavoriteGroupSourceMap;
    localWorldFavorites?: FavoriteGroupSourceMap;
}): FavoriteGroup[] {
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

    return buildLocalFavoriteGroups(names || [], source || {});
}

export function buildFavoriteAvatarHistoryGroups({
    kind,
    avatarHistoryLength,
    t
}: {
    kind: FavoriteKind;
    avatarHistoryLength: number;
    t: unknown;
}): FavoriteGroup[] {
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

export function buildFavoriteGroupLabelByKey(
    groups: readonly FavoriteGroupInput[] | null | undefined
) {
    return Object.fromEntries(
        (Array.isArray(groups) ? groups : []).map((group) => [
            group.key,
            group.label
        ])
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
    worldFactsById = {},
    remoteWorldCacheFallbacksById = {},
    remoteAvatarCacheFallbacksById = {},
    localWorldDetailsById = {},
    localAvatarDetailsById = {},
    remoteGroupLabelByKey,
    worldAvailabilityById = {},
    t
}: {
    kind: FavoriteKind;
    remoteGroups: readonly FavoriteGroupInput[];
    groupedFavoriteFriendIdsByGroupKey?: Record<string, unknown[]>;
    friendsById?: FavoriteProfileMap;
    knownUsersById?: FavoriteProfileMap;
    favoritesSortIndex?: FavoriteSortIndex;
    sortValue?: FavoriteSortValue;
    remoteFavoritesById?: Record<string, FavoriteRecord | undefined>;
    remoteEntityDetailsData?: FavoriteDetailMap;
    remoteEntityDetailsStatus?: string;
    worldFactsById?: FavoriteDetailMap;
    remoteWorldCacheFallbacksById?: FavoriteDetailMap;
    remoteAvatarCacheFallbacksById?: FavoriteDetailMap;
    localWorldDetailsById?: FavoriteDetailMap;
    localAvatarDetailsById?: FavoriteDetailMap;
    remoteGroupLabelByKey?: Record<string, string | undefined>;
    worldAvailabilityById?: Record<string, string | undefined>;
    t: unknown;
}): FavoriteItemsByGroup {
    const translate = resolveTranslator(t);
    const itemsByGroup: FavoriteItemsByGroup = Object.create(null);
    for (const group of remoteGroups) {
        itemsByGroup[group.key] = [];
    }

    if (kind === 'friend') {
        for (const group of remoteGroups) {
            const ids = groupedFavoriteFriendIdsByGroupKey?.[group.key] || [];
            const items = ids.map((friendId, index) =>
                buildFriendFavoriteItem({
                    kind,
                    source: 'remote',
                    groupKey: group.key,
                    groupLabel: group.label,
                    friendId,
                    friend: friendsById?.[normalizeEntityId(friendId)],
                    knownUser: knownUsersById?.[normalizeEntityId(friendId)],
                    index,
                    favoritesSortIndex,
                    t: translate
                })
            );
            itemsByGroup[group.key] = sortItems(items, sortValue);
        }

        return itemsByGroup;
    }

    const remoteFavorites = Object.values(remoteFavoritesById || {})
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

        const detail = remoteEntityDetailsData?.[favoriteId];
        let liveDetail: FavoriteEntityDetail | null = null;
        let fallbackDetail: FavoriteEntityDetail | null | undefined = null;

        if (kind === 'world') {
            liveDetail = hasDisplayableEntityDetail(detail) ? detail : null;
            fallbackDetail = firstDisplayableDetail([
                worldFactsById[favoriteId],
                remoteWorldCacheFallbacksById[favoriteId],
                localWorldDetailsById[favoriteId]
            ]);
        } else {
            const isHiddenRemoteAvatar =
                hasDisplayableEntityDetail(detail) &&
                String(detail.releaseStatus ?? '').toLowerCase() === 'hidden';
            liveDetail =
                hasDisplayableEntityDetail(detail) && !isHiddenRemoteAvatar
                    ? detail
                    : null;
            fallbackDetail = firstDisplayableDetail([
                isHiddenRemoteAvatar ? detail : null,
                localAvatarDetailsById[favoriteId],
                remoteAvatarCacheFallbacksById[favoriteId]
            ]);
        }

        const displayDetail = liveDetail || fallbackDetail || null;
        const usedFallback = !liveDetail && Boolean(displayDetail);
        const availabilityStatus =
            kind === 'world' ? worldAvailabilityById[favoriteId] : undefined;
        const isDeleted = availabilityStatus === 'deleted';
        const isUnavailable =
            remoteEntityDetailsStatus === 'ready' && !displayDetail;
        const releaseStatusPrivate =
            textValue(displayDetail?.releaseStatus) === 'private';
        const isPrivate =
            kind === 'world'
                ? !isDeleted &&
                  (releaseStatusPrivate ||
                      availabilityStatus === 'private' ||
                      (usedFallback && !availabilityStatus))
                : releaseStatusPrivate || usedFallback;
        const playerCount = Number(displayDetail?.occupants) || 0;
        const authorName = textValue(displayDetail?.authorName);
        const subtitle =
            authorName ||
            defaultFavoriteDetailSubtitle(
                kind,
                isUnavailable,
                translate,
                isDeleted
            );

        const imagePair = favoriteImagePair(displayDetail);

        itemsByGroup[groupKey].push({
            key: `remote:${groupKey}:${favoriteId}`,
            kind,
            source: 'remote',
            groupKey,
            groupLabel:
                remoteGroupLabelByKey?.[groupKey] ||
                translate('view.favorites.empty.favorites_fallback'),
            id: favoriteId,
            title:
                textValue(displayDetail?.name) ||
                defaultFavoriteEntityTitle(kind, translate),
            subtitle,
            authorName,
            description: textValue(displayDetail?.description),
            seedData: favoriteSeedData(displayDetail),
            ...imagePair,
            isPrivate,
            isDeleted,
            isUnavailable,
            tags: stringArray(displayDetail?.tags),
            playerCount,
            orderIndex:
                favoritesSortIndex?.[favoriteId] ?? Number.MAX_SAFE_INTEGER
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
}: {
    kind: FavoriteKind;
    localGroups: readonly FavoriteGroupInput[];
    localFriendFavorites?: FavoriteGroupSourceMap;
    localAvatarFavorites?: FavoriteGroupSourceMap;
    localWorldFavorites?: FavoriteGroupSourceMap;
    localAvatarDetailsById?: FavoriteDetailMap;
    localWorldDetailsById?: FavoriteDetailMap;
    friendsById?: FavoriteProfileMap;
    knownUsersById?: FavoriteProfileMap;
    sortValue?: FavoriteSortValue;
    t: unknown;
}): FavoriteItemsByGroup {
    const translate = resolveTranslator(t);
    const itemsByGroup: FavoriteItemsByGroup = Object.create(null);

    if (kind === 'friend') {
        for (const group of localGroups) {
            const ids = Array.isArray(localFriendFavorites?.[group.key])
                ? localFriendFavorites[group.key]
                : [];
            const items = ids.map((friendId, index) =>
                buildFriendFavoriteItem({
                    kind,
                    source: 'local',
                    groupKey: group.key,
                    groupLabel: group.label,
                    friendId,
                    friend: friendsById?.[normalizeEntityId(friendId)],
                    knownUser: knownUsersById?.[normalizeEntityId(friendId)],
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
        const ids = Array.isArray(localFavorites?.[group.key])
            ? localFavorites[group.key]
            : [];
        const items: FavoriteItem[] = ids.map((entityId, index) => {
            const normalizedId = normalizeEntityId(entityId);
            const detail = localDetailsById?.[normalizedId] || {
                id: normalizedId
            };
            const playerCount = Number(detail.occupants) || 0;
            const imagePair = favoriteImagePair(detail);
            return {
                key: `local:${group.key}:${normalizedId}`,
                kind,
                source: 'local',
                groupKey: group.key,
                groupLabel: group.label,
                id: normalizedId,
                title:
                    textValue(detail.name) ||
                    defaultFavoriteEntityTitle(kind, translate),
                subtitle: textValue(detail.authorName),
                authorName: textValue(detail.authorName),
                description: textValue(detail.description),
                seedData: favoriteSeedData(detail),
                ...imagePair,
                isPrivate: textValue(detail.releaseStatus) === 'private',
                isUnavailable: false,
                tags: stringArray(detail.tags),
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
}: {
    kind: FavoriteKind;
    avatarHistory: readonly FavoriteEntityDetail[];
    t: unknown;
}): FavoriteItem[] {
    if (kind !== 'avatar') {
        return [];
    }

    const translate = resolveTranslator(t);
    const groupLabel = translate('view.favorite.avatars.local_history');

    return avatarHistory.map((detail, index) => {
        const normalizedId = normalizeEntityId(detail?.id);
        const imagePair = favoriteImagePair(detail);
        return {
            key: `history:local-history:${normalizedId || index}`,
            kind: 'avatar',
            source: 'history',
            groupKey: 'local-history',
            groupLabel,
            id: normalizedId,
            title:
                textValue(detail?.name) ||
                translate('view.favorites.empty.avatar_fallback'),
            subtitle: textValue(detail?.authorName),
            authorName: textValue(detail?.authorName),
            description: textValue(detail?.description),
            seedData: favoriteSeedData(detail),
            ...imagePair,
            isPrivate: textValue(detail?.releaseStatus) === 'private',
            isUnavailable: false,
            tags: stringArray(detail?.tags),
            playerCount: 0,
            orderIndex: index
        };
    });
}
