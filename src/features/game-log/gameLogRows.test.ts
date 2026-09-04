import { describe, expect, it } from 'vitest';

import {
    buildGameLogFavoriteIdSet,
    canDeleteGameLogRow,
    collectGameLogSessionFriends,
    describeGameLogDetail,
    getGameLogCopyTarget,
    getGameLogExternalTarget,
    getGameLogLocationTarget,
    getGameLogRowKey,
    getGameLogSessionKey,
    getGameLogSessionPlayerAffinity,
    resolveGameLogSessionDuration,
    resolveGameLogWorldId,
    resolveGameLogWorldTarget,
    shouldLinkGameLogPrimaryDetailToWorld
} from './gameLogRows';
import type { GameLogSessionEvent, GameLogSessionMember } from './gameLogTypes';

describe('gameLogRows', () => {
    it('builds the detail text users see for common game-log row types', () => {
        expect(
            describeGameLogDetail({
                type: 'Location',
                worldName: 'The Black Cat',
                location: 'wrld_cat:123'
            })
        ).toEqual({
            primary: 'The Black Cat',
            secondary: ''
        });
        expect(
            describeGameLogDetail({
                type: 'VideoPlay',
                videoId: 'yt_1',
                videoName: 'Launch Trailer'
            })
        ).toEqual({
            primary: 'yt_1: Launch Trailer',
            secondary: ''
        });
        expect(describeGameLogDetail({ type: 'OnPlayerJoined' })).toEqual({
            primary: '',
            secondary: ''
        });
        expect(
            describeGameLogDetail({
                type: 'StringLoad',
                resourceUrl: 'https://example.test/file.txt'
            })
        ).toEqual({
            primary: 'https://example.test/file.txt',
            secondary: ''
        });
    });

    it('resolves the world target and location users can open from row details', () => {
        expect(
            resolveGameLogWorldTarget({
                type: 'PortalSpawn',
                instanceId: 'wrld_portal:123'
            })
        ).toBe('wrld_portal:123');
        expect(
            resolveGameLogWorldTarget({
                type: 'Location',
                location: 'wrld_direct:456'
            })
        ).toBe('wrld_direct:456');
        expect(resolveGameLogWorldId({ worldId: 'wrld_only' })).toBe(
            'wrld_only'
        );
        expect(
            getGameLogLocationTarget({
                type: 'PortalSpawn',
                instanceId: 'wrld_portal:123',
                location: 'wrld_fallback:456'
            })
        ).toBe('wrld_portal:123');
        expect(
            shouldLinkGameLogPrimaryDetailToWorld({ type: 'Location' })
        ).toBe(true);
        expect(
            shouldLinkGameLogPrimaryDetailToWorld({ type: 'VideoPlay' })
        ).toBe(false);
    });

    it('chooses copy and external-link targets that match the row action menu', () => {
        expect(
            getGameLogExternalTarget({
                type: 'VideoPlay',
                videoId: 'yt_1',
                videoUrl: 'https://video.example.test/watch'
            })
        ).toBe('https://video.example.test/watch');
        expect(
            getGameLogExternalTarget({
                type: 'VideoPlay',
                videoId: 'LSMedia',
                videoUrl: 'https://blocked.example.test/watch'
            })
        ).toBe('');
        expect(
            getGameLogExternalTarget({
                type: 'ImageLoad',
                resourceUrl: 'https://cdn.example.test/image.png'
            })
        ).toBe('https://cdn.example.test/image.png');

        expect(
            getGameLogCopyTarget({ type: 'Event', data: 'Joined lobby' })
        ).toBe('Joined lobby');
        expect(
            getGameLogCopyTarget({
                type: 'VideoPlay',
                videoName: 'Fallback video'
            })
        ).toBe('Fallback video');
        expect(
            getGameLogCopyTarget({ type: 'OnPlayerLeft', message: 'left' })
        ).toBe('');
    });

    it('keeps only actionable rows deletable and gives rows stable keys', () => {
        expect(canDeleteGameLogRow({ type: 'Event' })).toBe(true);
        expect(canDeleteGameLogRow({ type: 'Location' })).toBe(false);
        expect(canDeleteGameLogRow({ type: 'OnPlayerJoined' })).toBe(false);

        expect(
            getGameLogRowKey({
                type: 'VideoPlay',
                created_at: '2026-04-16T00:00:00.000Z',
                videoUrl: 'https://video.example.test/watch',
                rowId: 1
            })
        ).toBe(
            'VideoPlay:2026-04-16T00:00:00.000Z:https://video.example.test/watch:1'
        );
        expect(
            getGameLogSessionKey({
                id: 1,
                created_at: '2026-04-16T00:00:00.000Z',
                location: 'wrld_session:1'
            })
        ).toBe('1:2026-04-16T00:00:00.000Z:wrld_session:1');
    });

    it('resolves session affinity from local and remote favorites', () => {
        const favoriteIds = buildGameLogFavoriteIdSet(
            ['usr_remote', ' usr_trimmed '],
            {
                favorite: ['usr_favorite', ' usr_trimmed ']
            }
        );
        const friendIds = new Set(['usr_friend', 'usr_member']);

        const event: GameLogSessionEvent = {
            type: 'OnPlayerJoined',
            created_at: '2026-04-16T00:00:00.000Z',
            userId: 'usr_friend'
        };
        const members: GameLogSessionMember[] = [
            {
                created_at: '2026-04-16T00:00:00.000Z',
                displayName: 'Remote',
                userId: 'usr_remote',
                isFavorite: false
            },
            {
                created_at: '2026-04-16T00:00:00.000Z',
                displayName: 'Favorite',
                userId: 'usr_favorite',
                isFavorite: false
            },
            {
                created_at: '2026-04-16T00:00:00.000Z',
                displayName: 'Member',
                userId: 'usr_member',
                isFavorite: false
            },
            {
                created_at: '2026-04-16T00:00:00.000Z',
                displayName: '',
                userId: '',
                isFavorite: false
            }
        ];

        expect(
            getGameLogSessionPlayerAffinity(event, favoriteIds, friendIds)
        ).toEqual({
            isFriend: true,
            isFavorite: false
        });
        expect(
            members.map((member) =>
                getGameLogSessionPlayerAffinity(member, favoriteIds, friendIds)
            )
        ).toEqual([
            { isFavorite: true, isFriend: false },
            { isFavorite: true, isFriend: false },
            { isFavorite: false, isFriend: true },
            { isFavorite: false, isFriend: false }
        ]);
    });

    it.each([undefined, null, '', ' '])(
        'ignores embedded flags without a valid user ID: %j',
        (userId) => {
            const player = {
                type: 'OnPlayerLeft',
                userId,
                isFavorite: true,
                isFriend: true
            };
            const ids = new Set(['']);

            expect(getGameLogSessionPlayerAffinity(player, ids, ids)).toEqual({
                isFavorite: false,
                isFriend: false
            });
        }
    );

    it('ignores stale flags for users removed from the current sets', () => {
        const player = {
            userId: 'usr_removed',
            isFavorite: true,
            isFriend: true
        };
        expect(
            getGameLogSessionPlayerAffinity(player, new Set(), new Set())
        ).toEqual({
            isFavorite: false,
            isFriend: false
        });
    });

    it('deduplicates session friends and sorts favorites from the current sets', () => {
        const alice = {
            userId: ' usr_alice ',
            displayName: 'Alice',
            created_at: '',
            isFavorite: false
        };
        const bob = {
            userId: 'usr_bob',
            displayName: 'Bob',
            created_at: '',
            isFavorite: false
        };
        const events: GameLogSessionEvent[] = [
            { ...alice, type: 'OnPlayerJoined' },
            { type: 'JoinGroup', created_at: '', members: [alice, bob] },
            {
                type: 'OnPlayerJoined',
                created_at: '',
                displayName: 'No ID',
                userId: '',
                isFavorite: false
            },
            {
                type: 'JoinGroup',
                created_at: '',
                members: [
                    {
                        userId: '',
                        displayName: 'Ignored member',
                        created_at: '',
                        isFavorite: false
                    }
                ]
            }
        ];
        const friends = collectGameLogSessionFriends(
            events,
            new Set(['usr_bob']),
            new Set(['usr_alice', 'usr_bob'])
        );

        expect(
            friends.map(({ userId, displayName, isFavorite }) => [
                userId,
                displayName,
                isFavorite
            ])
        ).toEqual([
            ['usr_bob', 'Bob', true],
            ['usr_alice', 'Alice', false]
        ]);
        expect(
            collectGameLogSessionFriends(
                events,
                new Set(),
                new Set(['usr_alice'])
            ).map(({ displayName }) => displayName)
        ).toEqual(['Alice']);
        expect(alice.isFavorite).toBe(false);
    });

    it('normalizes the visible session duration', () => {
        expect(resolveGameLogSessionDuration({ duration: 120000 })).toBe(
            120000
        );
        expect(resolveGameLogSessionDuration({ duration: -1 })).toBe(0);
    });
});
