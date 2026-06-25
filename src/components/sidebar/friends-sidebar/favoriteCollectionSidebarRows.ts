import { normalizeString as normalizeId } from '@/shared/utils/string';

import { buildSameInstanceGroups } from './friendsSidebarModel';

interface BuildFavoriteCollectionFriendIdSetOptions {
    sourceGroupKeys?: string[];
    groupedFavoriteFriendIdsByGroupKey?: Record<string, string[]>;
    localFriendFavorites?: Record<string, string[]>;
}

function pushSection(
    nextRows: Array<Record<string, unknown>>,
    {
        id,
        title,
        count,
        open
    }: { id: string; title: string; count?: number; open?: boolean }
) {
    nextRows.push({
        type: 'section',
        key: `section:${id}`,
        id,
        title,
        count,
        open
    });
}

function pushFriendRows(
    nextRows: Array<Record<string, unknown>>,
    sectionKey: string,
    sectionRows: unknown[],
    {
        currentUserId,
        isGroupByInstance = false
    }: { currentUserId?: string; isGroupByInstance?: boolean } = {}
) {
    for (const friend of sectionRows as Array<Record<string, unknown>>) {
        const friendId = normalizeId(friend?.id);
        nextRows.push({
            type: 'friend',
            key: `friend:${sectionKey}:${friendId}`,
            friend,
            isCurrentUser: friendId === normalizeId(currentUserId),
            isGroupByInstance: Boolean(isGroupByInstance)
        });
    }
}

function pushSkeletonRows(
    nextRows: Array<Record<string, unknown>>,
    key: string,
    count: any = 6
) {
    for (let index = 0; index < count; index += 1) {
        nextRows.push({
            type: 'skeleton',
            key: `skeleton:${key}:${index}`
        });
    }
}

export function buildFavoriteCollectionFriendIdSet({
    sourceGroupKeys = [],
    groupedFavoriteFriendIdsByGroupKey = {},
    localFriendFavorites = {}
}: BuildFavoriteCollectionFriendIdSetOptions): Set<string> {
    const ids = new Set<string>();
    for (const key of sourceGroupKeys) {
        const normalizedKey = normalizeId(key);
        if (!normalizedKey) {
            continue;
        }
        const sourceIds = normalizedKey.startsWith('local:')
            ? localFriendFavorites[normalizedKey.slice(6)]
            : groupedFavoriteFriendIdsByGroupKey[normalizedKey];
        for (const id of sourceIds || []) {
            const normalizedId = normalizeId(id);
            if (normalizedId) {
                ids.add(normalizedId);
            }
        }
    }
    return ids;
}

export function buildFavoriteCollectionSameInstanceGroups({
    rows,
    prefs,
    currentLocationSnapshot,
    fallbackJoinTimes
}: {
    rows: unknown[];
    prefs: Record<string, unknown>;
    currentLocationSnapshot: unknown;
    fallbackJoinTimes: Map<string, number>;
}) {
    if (!prefs?.sidebarGroupByInstance) {
        return [];
    }
    return buildSameInstanceGroups(
        rows,
        prefs,
        currentLocationSnapshot,
        fallbackJoinTimes
    );
}

export function buildFavoriteCollectionSidebarVirtualRows({
    activeRows,
    currentUserId,
    emptyText,
    loadStatus,
    offlineRows,
    onlineRows,
    openGroups,
    rowsLength,
    sameInstanceGroups,
    t
}: {
    activeRows: unknown[];
    currentUserId?: string;
    emptyText: string;
    loadStatus?: string;
    offlineRows: unknown[];
    onlineRows: unknown[];
    openGroups: Record<string, boolean>;
    rowsLength: number;
    sameInstanceGroups: Array<{ location: string; rows: unknown[] }>;
    t: (key: string) => string;
}) {
    const nextRows: Array<Record<string, unknown>> = [];

    if (loadStatus === 'running' && !rowsLength) {
        pushSkeletonRows(nextRows, 'favorite-collection-loading');
        nextRows.push({ type: 'footer', key: 'footer' });
        return nextRows;
    }

    if (sameInstanceGroups.length) {
        pushSection(nextRows, {
            id: 'sameInstance',
            title: t('side_panel.same_instance'),
            count: sameInstanceGroups.length,
            open: openGroups.sameInstance
        });
        if (openGroups.sameInstance) {
            sameInstanceGroups.forEach((group: any, index: any) => {
                nextRows.push({
                    type: 'instance-header',
                    key: `instance:${group.location}:${index}`,
                    location: group.location,
                    count: group.rows.length
                });
                pushFriendRows(
                    nextRows,
                    `favoriteCollection:sameInstance:${group.location}:${index}`,
                    group.rows,
                    { currentUserId, isGroupByInstance: true }
                );
            });
        }
    }

    pushSection(nextRows, {
        id: 'online',
        title: t('side_panel.online'),
        count: onlineRows.length,
        open: openGroups.online
    });
    if (openGroups.online) {
        pushFriendRows(nextRows, 'favoriteCollection:online', onlineRows, {
            currentUserId
        });
    }

    pushSection(nextRows, {
        id: 'active',
        title: t('side_panel.active'),
        count: activeRows.length,
        open: openGroups.active
    });
    if (openGroups.active) {
        pushFriendRows(nextRows, 'favoriteCollection:active', activeRows, {
            currentUserId
        });
    }

    pushSection(nextRows, {
        id: 'offline',
        title: t('side_panel.offline'),
        count: offlineRows.length,
        open: openGroups.offline
    });
    if (openGroups.offline) {
        pushFriendRows(nextRows, 'favoriteCollection:offline', offlineRows, {
            currentUserId
        });
    }

    if (!rowsLength && loadStatus !== 'running') {
        nextRows.push({
            type: 'message',
            key: 'message:empty-favorite-collection',
            text: emptyText
        });
    }

    nextRows.push({ type: 'footer', key: 'footer' });
    return nextRows;
}
