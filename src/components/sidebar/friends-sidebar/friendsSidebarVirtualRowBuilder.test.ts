import { describe, expect, it } from 'vitest';

import { buildFriendsSidebarVirtualRows } from './friendsSidebarVirtualRowBuilder';

const t = (key: string) => key;

describe('friendsSidebarVirtualRowBuilder', () => {
    it('builds loading skeleton rows before the footer', () => {
        const rows = buildFriendsSidebarVirtualRows({
            activeRows: [],
            currentUser: null,
            currentUserId: 'usr_me',
            favoriteGroupSections: [],
            favoriteRows: [],
            gameState: {},
            loadStatus: 'running',
            offlineRows: [],
            onlineRows: [],
            openGroups: {},
            prefs: {},
            rowsLength: 0,
            sameInstanceGroups: [],
            t
        });

        expect(rows.map((row) => row.type)).toEqual([
            'skeleton',
            'skeleton',
            'skeleton',
            'skeleton',
            'skeleton',
            'skeleton',
            'footer'
        ]);
    });

    it('orders same-instance and favorite sections from preferences and marks current user rows', () => {
        const rows = buildFriendsSidebarVirtualRows({
            activeRows: [{ id: 'usr_active' }],
            currentUser: {
                id: 'usr_me',
                displayName: 'Me',
                location: 'wrld_live:1',
                status: 'join me'
            },
            currentUserId: 'usr_me',
            favoriteGroupSections: [
                {
                    key: 'remote:favorites',
                    label: 'Favorites',
                    rows: [{ id: 'usr_favorite' }]
                }
            ],
            favoriteRows: [{ id: 'usr_favorite' }],
            gameState: {
                isGameRunning: true,
                currentLocation: 'wrld_live:1'
            },
            loadStatus: 'ready',
            offlineRows: [{ id: 'usr_offline' }],
            onlineRows: [{ id: 'usr_online' }],
            openGroups: {
                me: true,
                sameInstance: true,
                favorites: true,
                online: false,
                active: true,
                offline: true
            },
            prefs: {
                isSameInstanceAboveFavorites: true,
                isSidebarDivideByFriendGroup: true,
                gameLogDisabled: false
            },
            rowsLength: 5,
            sameInstanceGroups: [
                {
                    location: 'wrld_live:1',
                    rows: [{ id: 'usr_same' }],
                    isCurrentInstance: true
                }
            ],
            t
        });

        expect(rows.map((row) => row.key)).toEqual([
            'section:me',
            'friend:me:usr_me',
            'section:sameInstance',
            'instance:wrld_live:1:0',
            'friend:sameInstance:wrld_live:1:0:currentUser:usr_me',
            'friend:sameInstance:wrld_live:1:0:usr_same',
            'section:favorites',
            'favorite-group:remote:favorites',
            'friend:favorites:remote:favorites:usr_favorite',
            'section:online',
            'section:active',
            'friend:active:usr_active',
            'section:offline',
            'friend:offline:usr_offline',
            'footer'
        ]);
        expect(rows[1]).toMatchObject({
            type: 'friend',
            isCurrentUser: true
        });
        expect(rows[3]).toMatchObject({
            type: 'instance-header',
            count: 1,
            isCurrentInstance: true
        });
        expect(rows[4]).toMatchObject({
            isCurrentUser: true,
            isGroupByInstance: true
        });
        expect(rows[5]).toMatchObject({
            isGroupByInstance: true
        });
    });

    it('can hide the current user from a valid same-instance group while preserving the me row', () => {
        const rows = buildFriendsSidebarVirtualRows({
            activeRows: [],
            currentUser: {
                id: 'usr_me',
                displayName: 'Me',
                location: 'wrld_live:1'
            },
            currentUserId: 'usr_me',
            favoriteGroupSections: [],
            favoriteRows: [],
            gameState: {
                isGameRunning: true,
                currentLocation: 'wrld_live:1'
            },
            loadStatus: 'ready',
            offlineRows: [],
            onlineRows: [],
            openGroups: {
                me: true,
                sameInstance: true
            },
            prefs: {
                isShowCurrentUserInSameInstance: false
            },
            rowsLength: 1,
            sameInstanceGroups: [
                {
                    location: 'wrld_live:1',
                    rows: [{ id: 'usr_same' }, { id: 'usr_other' }],
                    isCurrentInstance: true
                }
            ],
            t
        });

        expect(
            rows
                .filter((row) => row.type === 'friend' && row.isCurrentUser)
                .map((row) => row.key)
        ).toEqual(['friend:me:usr_me']);
        expect(rows.map((row) => row.key)).toContain(
            'friend:sameInstance:wrld_live:1:0:usr_same'
        );
    });
});
