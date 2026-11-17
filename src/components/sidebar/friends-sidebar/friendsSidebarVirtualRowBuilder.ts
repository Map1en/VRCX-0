import type { CurrentUserPresenceRecord } from '@/shared/utils/currentUserPresence';
import { normalizeString as normalizeId } from '@/shared/utils/string';

import type {
    SameInstanceGroup,
    SidebarFriendRecord,
    SidebarPreferences
} from './friendsSidebarModel';
import type { FriendsSidebarOpenGroups } from './useFriendsSidebarPreferences';

export interface SidebarVirtualRow {
    type:
        | 'section'
        | 'friend'
        | 'skeleton'
        | 'footer'
        | 'favorite-group-header'
        | 'instance-header'
        | 'message';
    key?: string;
    id?: string;
    title?: string;
    count?: number;
    open?: boolean;
    label?: string;
    location?: string;
    friend?: SidebarFriendRecord;
    isCurrentUser?: boolean;
    isCurrentInstance?: boolean;
    isGroupByInstance?: boolean;
    instanceLocation?: string;
    className?: string;
    text?: string;
}

type SidebarSectionInput = {
    id: string;
    title: string;
    count?: number;
    open?: boolean;
};

type SidebarFriendRowsOptions = {
    currentUserId?: string | null;
    isCurrentUser?: boolean;
    isGroupByInstance?: boolean;
    instanceLocation?: string;
};

type FavoriteGroupSection = {
    key: string;
    label: string;
    rows: readonly SidebarFriendRecord[];
};

function pushSection(
    nextRows: SidebarVirtualRow[],
    { id, title, count, open }: SidebarSectionInput
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
        isCurrentUser = false,
        isGroupByInstance = false,
        instanceLocation
    }: SidebarFriendRowsOptions = {}
) {
    for (const friend of sectionRows) {
        const friendId = normalizeId(friend?.id);
        nextRows.push({
            type: 'friend',
            key: `friend:${sectionKey}:${friendId}`,
            friend,
            isCurrentUser: Boolean(
                isCurrentUser || friendId === normalizeId(currentUserId)
            ),
            isGroupByInstance: Boolean(isGroupByInstance),
            instanceLocation
        });
    }
}

function buildFriendRows(
    sectionKey: string,
    sectionRows: readonly SidebarFriendRecord[],
    options: SidebarFriendRowsOptions
) {
    const nextRows: SidebarVirtualRow[] = [];
    pushFriendRows(nextRows, sectionKey, sectionRows, options);
    return nextRows;
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

function buildFavoriteRows({
    currentUserId,
    favoriteGroupSections,
    favoriteRows,
    prefs
}: {
    currentUserId?: string | null;
    favoriteGroupSections: FavoriteGroupSection[];
    favoriteRows: readonly SidebarFriendRecord[];
    prefs: SidebarPreferences;
}) {
    const nextRows: SidebarVirtualRow[] = [];

    if (!prefs.isSidebarDivideByFriendGroup) {
        pushFriendRows(nextRows, 'favorites', favoriteRows, { currentUserId });
        return nextRows;
    }
    for (const section of favoriteGroupSections) {
        nextRows.push({
            type: 'favorite-group-header',
            key: `favorite-group:${section.key}`,
            label: section.label,
            count: section.rows.length
        });
        pushFriendRows(nextRows, `favorites:${section.key}`, section.rows, {
            currentUserId
        });
    }

    return nextRows;
}

function buildCurrentUserRows({
    currentUser,
    currentUserId,
    sectionKey = 'me',
    isGroupByInstance = false,
    showSkeleton = true
}: {
    currentUser: CurrentUserPresenceRecord | null | undefined;
    currentUserId?: string | null;
    sectionKey?: string;
    isGroupByInstance?: boolean;
    showSkeleton?: boolean;
}): SidebarVirtualRow[] {
    if (!currentUser) {
        if (!showSkeleton) {
            return [];
        }
        return Array.from(
            { length: 1 },
            (_unused, index): SidebarVirtualRow => ({
                type: 'skeleton',
                key: `skeleton:${sectionKey}:${index}`
            })
        );
    }

    const currentUserRow: SidebarFriendRecord = currentUser;
    return buildFriendRows(sectionKey, [currentUserRow], {
        currentUserId,
        isCurrentUser: true,
        isGroupByInstance
    });
}

export function buildFriendsSidebarVirtualRows({
    activeRows,
    currentUser,
    currentUserId,
    favoriteGroupSections,
    favoriteRows,
    loadStatus,
    offlineRows,
    onlineRows,
    openGroups,
    prefs,
    rowsLength,
    sameInstanceGroups,
    t
}: {
    activeRows: readonly SidebarFriendRecord[];
    currentUser: CurrentUserPresenceRecord | null | undefined;
    currentUserId?: string | null;
    favoriteGroupSections: FavoriteGroupSection[];
    favoriteRows: readonly SidebarFriendRecord[];
    loadStatus?: string;
    offlineRows: readonly SidebarFriendRecord[];
    onlineRows: readonly SidebarFriendRecord[];
    openGroups: Partial<FriendsSidebarOpenGroups>;
    prefs: SidebarPreferences;
    rowsLength: number;
    sameInstanceGroups: SameInstanceGroup[];
    t: (key: string) => string;
}) {
    const nextRows: SidebarVirtualRow[] = [];

    if (loadStatus === 'running' && !rowsLength) {
        pushSkeletonRows(nextRows, 'loading');
        nextRows.push({ type: 'footer', key: 'footer' });
        return nextRows;
    }

    const pushSameInstance = () => {
        if (!sameInstanceGroups.length) {
            return;
        }
        const instanceEntries = sameInstanceGroups.map((group, index) => {
            const sectionKey = `sameInstance:${group.location}:${index}`;
            const currentUserRows = group.isCurrentInstance
                ? buildCurrentUserRows({
                      currentUser,
                      currentUserId,
                      sectionKey: `${sectionKey}:currentUser`,
                      isGroupByInstance: true,
                      showSkeleton: false
                  })
                : [];
            return {
                group,
                sectionKey,
                headerKey: `instance:${group.location}:${index}`,
                currentUserRows,
                count: group.rows.length + currentUserRows.length
            };
        });
        pushSection(nextRows, {
            id: 'sameInstance',
            title: t('side_panel.same_instance'),
            open: openGroups.sameInstance
        });
        if (openGroups.sameInstance) {
            instanceEntries.forEach((entry) => {
                nextRows.push({
                    type: 'instance-header',
                    key: entry.headerKey,
                    location: entry.group.location,
                    count: entry.count,
                    isCurrentInstance: entry.group.isCurrentInstance
                });
                nextRows.push(...entry.currentUserRows);
                pushFriendRows(nextRows, entry.sectionKey, entry.group.rows, {
                    currentUserId,
                    isGroupByInstance: true,
                    instanceLocation: entry.group.location
                });
            });
        }
    };
    const pushFavorites = () => {
        if (!favoriteRows.length) {
            return;
        }
        pushSection(nextRows, {
            id: 'favorites',
            title: t('side_panel.favorite'),
            count: favoriteRows.length,
            open: openGroups.favorites
        });
        if (openGroups.favorites) {
            nextRows.push(
                ...buildFavoriteRows({
                    currentUserId,
                    favoriteGroupSections,
                    favoriteRows,
                    prefs
                })
            );
        }
    };

    if (prefs.isSameInstanceAboveFavorites) {
        pushSameInstance();
        pushFavorites();
    } else {
        pushFavorites();
        pushSameInstance();
    }

    pushSection(nextRows, {
        id: 'online',
        title: t('side_panel.online'),
        count: onlineRows.length,
        open: openGroups.online
    });
    if (openGroups.online) {
        nextRows.push(
            ...buildFriendRows('online', onlineRows, { currentUserId })
        );
    }

    pushSection(nextRows, {
        id: 'active',
        title: t('side_panel.active'),
        count: activeRows.length,
        open: openGroups.active
    });
    if (openGroups.active) {
        nextRows.push(
            ...buildFriendRows('active', activeRows, { currentUserId })
        );
    }

    pushSection(nextRows, {
        id: 'offline',
        title: t('side_panel.offline'),
        count: offlineRows.length,
        open: openGroups.offline
    });
    if (openGroups.offline) {
        nextRows.push(
            ...buildFriendRows('offline', offlineRows, { currentUserId })
        );
    }

    if (!rowsLength && loadStatus !== 'running') {
        pushSkeletonRows(nextRows, 'empty', 4);
    }

    nextRows.push({ type: 'footer', key: 'footer' });
    return nextRows;
}
