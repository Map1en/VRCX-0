// @ts-nocheck
import { describe, expect, it } from 'vitest';

import { enrichPlayerListRows } from './playerListEnrichment.js';

describe('enrichPlayerListRows', () => {
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
});
