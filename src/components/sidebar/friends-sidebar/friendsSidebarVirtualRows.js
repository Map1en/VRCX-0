import { buildCurrentUserPresenceView } from '@/shared/utils/currentUserPresence.js';

import {
    normalizeId,
    resolveCurrentUserStateBucket
} from './friendsSidebarModel.js';

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

function pushFavoriteRows(
    nextRows,
    { currentUserId, favoriteGroupSections, favoriteRows, prefs }
) {
    if (!prefs.isSidebarDivideByFriendGroup) {
        pushFriendRows(nextRows, 'favorites', favoriteRows, { currentUserId });
        return;
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
}

export function buildFriendsSidebarVirtualRows({
    activeRows,
    currentUser,
    currentUserId,
    detail,
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
        nextRows.push({
            type: 'message',
            key: 'message:loading',
            className: '',
            text: detail || 'Loading friends'
        });
    }

    pushSection(nextRows, {
        id: 'me',
        title: t('side_panel.me'),
        open: openGroups.me
    });
    if (openGroups.me) {
        if (currentUser) {
            const currentUserRow = buildCurrentUserPresenceView(currentUser, {
                gameState,
                gameLogDisabled: Boolean(prefs.gameLogDisabled)
            });
            pushFriendRows(
                nextRows,
                'me',
                [
                    {
                        ...currentUserRow,
                        stateBucket:
                            resolveCurrentUserStateBucket(currentUserRow)
                    }
                ],
                { currentUserId, isCurrentUser: true }
            );
        } else {
            nextRows.push({
                type: 'message',
                key: 'message:me',
                className: 'px-2 py-1',
                text: 'No current user snapshot.'
            });
        }
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
            pushFavoriteRows(nextRows, {
                currentUserId,
                favoriteGroupSections,
                favoriteRows,
                prefs
            });
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
        pushFriendRows(nextRows, 'online', onlineRows, { currentUserId });
    }

    pushSection(nextRows, {
        id: 'active',
        title: t('side_panel.active'),
        count: activeRows.length,
        open: openGroups.active
    });
    if (openGroups.active) {
        pushFriendRows(nextRows, 'active', activeRows, { currentUserId });
    }

    pushSection(nextRows, {
        id: 'offline',
        title: t('side_panel.offline'),
        count: offlineRows.length,
        open: openGroups.offline
    });
    if (openGroups.offline) {
        pushFriendRows(nextRows, 'offline', offlineRows, { currentUserId });
    }

    if (!rowsLength && loadStatus !== 'running') {
        nextRows.push({
            type: 'message',
            key: 'message:empty',
            className: 'mt-4',
            text: detail || 'No friend roster snapshot.'
        });
    }

    nextRows.push({ type: 'footer', key: 'footer' });
    return nextRows;
}
