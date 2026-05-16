// @ts-nocheck
import { buildCurrentUserPresenceView } from '@/shared/utils/currentUserPresence.js';

import {
    normalizeId,
    resolveCurrentUserStateBucket
} from './friendsSidebarModel.js';

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

function pushSection(nextRows, { id, title, count, open }) {
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
    nextRows,
    sectionKey,
    sectionRows,
    { currentUserId, isCurrentUser = false, isGroupByInstance = false } = {}
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

function buildFriendRows(sectionKey, sectionRows, options) {
    const nextRows = [];
    pushFriendRows(nextRows, sectionKey, sectionRows, options);
    return nextRows;
}

function pushSkeletonRows(nextRows, key, count = 6) {
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
}) {
    const nextRows = [];

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

function stripStoppedGameCurrentUserPresence(currentUser, gameState) {
    if (!currentUser || gameState?.isGameRunning !== false) {
        return currentUser;
    }
    const strippedUser = { ...currentUser };
    for (const field of STOPPED_GAME_CURRENT_USER_PRESENCE_FIELDS) {
        delete strippedUser[field];
    }
    return strippedUser;
}

function buildCurrentUserRows({
    currentUser,
    currentUserId,
    gameState,
    prefs
}) {
    if (!currentUser) {
        return Array.from({ length: 1 }, (_, index) => ({
            type: 'skeleton',
            key: `skeleton:me:${index}`
        }));
    }

    const currentUserRow = buildCurrentUserPresenceView(currentUser, {
        gameState,
        gameLogDisabled: Boolean(prefs.gameLogDisabled)
    });
    const currentUserDisplayRow = stripStoppedGameCurrentUserPresence(
        currentUserRow,
        gameState
    );

    return buildFriendRows(
        'me',
        [
            {
                ...currentUserDisplayRow,
                stateBucket: resolveCurrentUserStateBucket(
                    currentUserDisplayRow
                )
            }
        ],
        { currentUserId, isCurrentUser: true }
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
}) {
    const nextRows = [];

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
                    count: group.rows.length
                });
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
