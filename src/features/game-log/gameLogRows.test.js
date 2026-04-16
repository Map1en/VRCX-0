import { describe, expect, it } from 'vitest';

import {
    annotateGameLogSessionEvent,
    buildGameLogFavoriteIdSet,
    canDeleteGameLogRow,
    countGameLogSessionEvent,
    describeGameLogDetail,
    getGameLogCopyTarget,
    getGameLogExternalTarget,
    getGameLogLocationTarget,
    getGameLogRowKey,
    getGameLogSessionKey,
    resolveGameLogSessionDuration,
    resolveGameLogWorldId,
    resolveGameLogWorldTarget,
    shouldLinkGameLogPrimaryDetailToWorld
} from './gameLogRows.js';

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
        expect(resolveGameLogWorldId({ worldId: 'wrld_only' })).toBe('wrld_only');
        expect(
            getGameLogLocationTarget({
                type: 'PortalSpawn',
                instanceId: 'wrld_portal:123',
                location: 'wrld_fallback:456'
            })
        ).toBe('wrld_portal:123');
        expect(shouldLinkGameLogPrimaryDetailToWorld({ type: 'Location' })).toBe(
            true
        );
        expect(shouldLinkGameLogPrimaryDetailToWorld({ type: 'VideoPlay' })).toBe(
            false
        );
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

        expect(getGameLogCopyTarget({ type: 'Event', data: 'Joined lobby' })).toBe(
            'Joined lobby'
        );
        expect(
            getGameLogCopyTarget({
                type: 'VideoPlay',
                videoName: 'Fallback video'
            })
        ).toBe('Fallback video');
        expect(getGameLogCopyTarget({ type: 'OnPlayerLeft', message: 'left' })).toBe(
            ''
        );
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
                id: 'row_1'
            })
        ).toBe(
            'VideoPlay:2026-04-16T00:00:00.000Z:https://video.example.test/watch:row_1'
        );
        expect(
            getGameLogSessionKey({
                id: 'session_1',
                created_at: '2026-04-16T00:00:00.000Z',
                location: 'wrld_session:1'
            })
        ).toBe('session_1:2026-04-16T00:00:00.000Z:wrld_session:1');
    });

    it('marks session events and counts grouped joins/leaves the way the session summary displays them', () => {
        const favoriteIds = buildGameLogFavoriteIdSet({
            favorite: ['usr_favorite', ' usr_trimmed ']
        });
        const friendIds = new Set(['usr_friend', 'usr_member']);

        const annotated = annotateGameLogSessionEvent(
            {
                type: 'JoinGroup',
                userId: 'usr_friend',
                members: [
                    { userId: 'usr_favorite' },
                    { userId: 'usr_member' },
                    { userId: '' }
                ]
            },
            favoriteIds,
            friendIds
        );

        expect(annotated.isFriend).toBe(true);
        expect(annotated.isFavorite).toBe(false);
        expect(annotated.members.map((member) => [member.isFavorite, member.isFriend])).toEqual([
            [true, false],
            [false, true],
            [false, false]
        ]);

        expect(
            countGameLogSessionEvent(
                [
                    { type: 'JoinGroup', members: [{}, {}] },
                    { type: 'OnPlayerJoined' },
                    { type: 'LeftGroup', count: 3 },
                    { type: 'VideoPlay' }
                ],
                'OnPlayerJoined'
            )
        ).toBe(3);
        expect(
            countGameLogSessionEvent(
                [
                    { type: 'LeftGroup', count: 3 },
                    { type: 'OnPlayerLeft' }
                ],
                'OnPlayerLeft'
            )
        ).toBe(4);
        expect(resolveGameLogSessionDuration({ duration: 120000 })).toBe(120000);
        expect(resolveGameLogSessionDuration({ duration: -1 })).toBe(0);
    });
});
