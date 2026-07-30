import { normalizeString as normalizeId } from '@/shared/utils/string';

import {
    buildSameInstanceGroups,
    type LastLocationSnapshot,
    type SameInstanceGroup,
    type SidebarFriendRecord,
    type SidebarPreferences
} from './friendsSidebarModel';
import type { SidebarVirtualRow } from './friendsSidebarVirtualRowBuilder';

interface BuildFavoriteCollectionFriendIdSetOptions {
    sourceGroupKeys?: string[];
    groupedFavoriteFriendIdsByGroupKey?: Record<string, string[]>;
    localFriendFavorites?: Record<string, string[]>;
}

function pushSection(
    nextRows: SidebarVirtualRow[],
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
    nextRows: SidebarVirtualRow[],
    sectionKey: string,
    sectionRows: readonly SidebarFriendRecord[],
    {
        currentUserId,
        isGroupByInstance = false
    }: { currentUserId?: string; isGroupByInstance?: boolean } = {}
) {
    for (const friend of sectionRows) {
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
    nextRows: SidebarVirtualRow[],
    key: string,
    count = 6
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
    rows: readonly SidebarFriendRecord[];
    prefs: SidebarPreferences;
    currentLocationSnapshot: LastLocationSnapshot;
    fallbackJoinTimes: Map<string, number>;
}): SameInstanceGroup[] {
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
    activeRows: readonly SidebarFriendRecord[];
    currentUserId?: string;
    emptyText: string;
    loadStatus?: string;
    offlineRows: readonly SidebarFriendRecord[];
    onlineRows: readonly SidebarFriendRecord[];
    openGroups: Record<string, boolean>;
    rowsLength: number;
    sameInstanceGroups: SameInstanceGroup[];
    t: (key: string) => string;
}): SidebarVirtualRow[] {
    const nextRows: SidebarVirtualRow[] = [];

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
            sameInstanceGroups.forEach((group, index) => {
                nextRows.push({
                    type: 'instance-header',
                    key: `instance:${group.location}:${index}`,
                    location: group.location,
                    count: group.rows.length,
                    isCurrentInstance: group.isCurrentInstance
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
