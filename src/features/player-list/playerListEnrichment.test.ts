import { describe, expect, it } from 'vitest';

import { enrichPlayerListRows } from './playerListEnrichment';

describe('enrichPlayerListRows', () => {
    it('derives the current user trust level from raw auth tags', () => {
        const [row] = enrichPlayerListRows({
            clockNow: Date.parse('2026-05-01T00:00:00.000Z'),
            context: {},
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Current User',
                tags: ['system_trust_veteran'],
                developerType: 'none'
            },
            favoriteFriendIds: new Set(),
            friendsById: {},
            playerSourceRows: [
                { userId: 'usr_self', displayName: 'Current User' }
            ]
        });

        expect(row.isCurrentUser).toBe(true);
        expect(row.trustLevel).toBe('Trusted User');
        expect(row.trustClass).toBe('x-tag-veteran');
        expect(row.trustSortNum).toBe(5);
    });

    it('uses full profile fields while keeping fresher friend presence fields', () => {
        const [row] = enrichPlayerListRows({
            clockNow: Date.parse('2026-05-01T00:00:00.000Z'),
            context: {
                location: 'wrld_live:123',
                worldName: 'Live World'
            },
            currentUserId: 'usr_self',
            currentUserSnapshot: null,
            favoriteFriendIds: new Set(),
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    status: 'join me',
                    statusDescription: 'Friend presence',
                    location: 'wrld_live:123',
                    bioLinks: []
                }
            },
            languageOptionsMap: new Map([
                ['jpn', { key: 'jpn', value: 'Japanese' }]
            ]),
            moderationByUserId: {},
            playerSourceRows: [
                {
                    userId: 'usr_friend',
                    displayName: 'Friend',
                    joinedAt: '2026-05-01T00:00:00.000Z'
                }
            ],
            profilesByUserId: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    status: 'active',
                    statusDescription: 'Profile presence',
                    bioLinks: ['https://example.test/profile'],
                    tags: ['system_trust_trusted', 'language_jpn'],
                    $trustLevel: 'Known User',
                    $trustClass: 'x-tag-trusted',
                    $platform: 'standalonewindows',
                    last_platform: 'standalonewindows'
                }
            }
        });

        expect(row.status).toBe('join me');
        expect(row.statusDescription).toBe('Friend presence');
        expect(row.bioLinks).toEqual(['https://example.test/profile']);
        expect(row.languages).toEqual([{ key: 'jpn', value: 'Japanese' }]);
        expect(row.platformLabel).toBe('PC');
        expect(row.trustLevel).toBe('Known User');
    });

    it('summarizes local block and mute moderation for display emphasis', () => {
        const rows = enrichPlayerListRows({
            clockNow: Date.parse('2026-05-01T00:00:00.000Z'),
            context: {},
            currentUserId: 'usr_self',
            currentUserSnapshot: null,
            favoriteFriendIds: new Set(),
            friendsById: {},
            moderationByUserId: {
                usr_blocked: {
                    userId: 'usr_blocked',
                    block: true
                },
                usr_muted: {
                    userId: 'usr_muted',
                    mute: true
                },
                usr_both: {
                    userId: 'usr_both',
                    block: true,
                    mute: true
                }
            },
            playerSourceRows: [
                { userId: 'usr_blocked', displayName: 'Blocked' },
                { userId: 'usr_muted', displayName: 'Muted' },
                { userId: 'usr_both', displayName: 'Both' },
                { id: 'display-only', displayName: 'Display Only' }
            ],
            profilesByUserId: {}
        });

        expect(rows[0].moderationSeverity).toBe('blocked');
        expect(rows[1].moderationSeverity).toBe('muted');
        expect(rows[2].moderationSeverity).toBe('blocked');
        expect(rows[3].moderationSeverity).toBe('');
    });
});
