import {
    buildCurrentUserPresenceView,
    type CurrentUserPresenceGameState,
    type CurrentUserPresenceRecord
} from '@/shared/utils/currentUserPresence';
import { normalizeString as normalizeId } from '@/shared/utils/string';

import {
    resolveCurrentUserStateBucket,
    type SameInstanceGroup,
    type SidebarFriendRecord,
    type SidebarPreferences
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
    location?: unknown;
    friend?: SidebarFriendRecord;
    isCurrentUser?: boolean;
    isCurrentInstance?: boolean;
    isGroupByInstance?: boolean;
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
};

type FavoriteGroupSection = {
    key: string;
    label: string;
    rows: readonly SidebarFriendRecord[];
};

type SidebarGameState = Record<string, unknown> & {
    isGameRunning?: boolean | null;
    currentLocation?: unknown;
    currentDestination?: unknown;
    currentWorldId?: unknown;
};

const STOPPED_GAME_CURRENT_USER_PRESENCE_FIELDS = [
    'location',
    '$location',
    '$locationTag',
    '$location_at',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime'
];

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
        isGroupByInstance = false
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
            isGroupByInstance: Boolean(isGroupByInstance)
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

function stripStoppedGameCurrentUserPresence(
    currentUser: CurrentUserPresenceRecord | null | undefined,
    gameState: SidebarGameState | null | undefined
) {
    if (!currentUser || gameState?.isGameRunning !== false) {
        return currentUser;
    }
    const strippedUser: CurrentUserPresenceRecord = { ...currentUser };
    for (const field of STOPPED_GAME_CURRENT_USER_PRESENCE_FIELDS) {
        delete strippedUser[field];
    }
    return strippedUser;
}

function buildCurrentUserRows({
    currentUser,
    currentUserId,
    gameState,
    prefs,
    sectionKey = 'me',
    isGroupByInstance = false,
    showSkeleton = true
}: {
    currentUser: CurrentUserPresenceRecord | null | undefined;
    currentUserId?: string | null;
    gameState: SidebarGameState | null | undefined;
    prefs: SidebarPreferences;
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

    const currentUserRow = buildCurrentUserPresenceView(currentUser, {
        gameState: gameState as CurrentUserPresenceGameState,
        gameLogDisabled: Boolean(prefs.gameLogDisabled)
    });
    const currentUserDisplayRow = stripStoppedGameCurrentUserPresence(
        currentUserRow,
        gameState
    );

    return buildFriendRows(
        sectionKey,
        [
            {
                ...currentUserDisplayRow,
                stateBucket: resolveCurrentUserStateBucket(
                    currentUserDisplayRow as SidebarFriendRecord
                )
            }
        ],
        { currentUserId, isCurrentUser: true, isGroupByInstance }
    );
}

export function buildFriendsSidebarVirtualRows({
    activeRows,
    currentUser,
    currentUserId,
    favoriteGroupSections,
    favoriteRows,
    gameState,
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
    gameState: SidebarGameState | null | undefined;
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

    pushSection(nextRows, {
        id: 'me',
        title: t('side_panel.me'),
        open: openGroups.me
    });
    if (openGroups.me) {
        nextRows.push(
            ...buildCurrentUserRows({
                currentUser,
                currentUserId,
                gameState,
                prefs
            })
        );
    }

    const pushSameInstance = () => {
        if (!sameInstanceGroups.length) {
            return;
        }
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
                if (
                    group.isCurrentInstance &&
                    prefs.isShowCurrentUserInSameInstance !== false
                ) {
                    nextRows.push(
                        ...buildCurrentUserRows({
                            currentUser,
                            currentUserId,
                            gameState,
                            prefs,
                            sectionKey: `sameInstance:${group.location}:${index}:currentUser`,
                            isGroupByInstance: true,
                            showSkeleton: false
                        })
                    );
                }
                pushFriendRows(
                    nextRows,
                    `sameInstance:${group.location}:${index}`,
                    group.rows,
                    { currentUserId, isGroupByInstance: true }
                );
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
