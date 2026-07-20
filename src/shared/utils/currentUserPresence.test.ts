import { describe, expect, it } from 'vitest';

import {
    buildCurrentUserPresenceView,
    isVisibleCurrentUserLocation,
    mergeCurrentUserPresenceFields
} from './currentUserPresence';

describe('isVisibleCurrentUserLocation', () => {
    it('returns false for hidden sentinel values', () => {
        expect(isVisibleCurrentUserLocation('offline')).toBe(false);
        expect(isVisibleCurrentUserLocation('private')).toBe(false);
        expect(isVisibleCurrentUserLocation('traveling')).toBe(false);
    });

    it('normalizes doubled sentinels', () => {
        expect(isVisibleCurrentUserLocation('offline:offline')).toBe(false);
        expect(isVisibleCurrentUserLocation('private:private')).toBe(false);
        expect(isVisibleCurrentUserLocation('traveling:traveling')).toBe(false);
    });

    it('returns false for empty or nullish values', () => {
        expect(isVisibleCurrentUserLocation('')).toBe(false);
        expect(isVisibleCurrentUserLocation(null)).toBe(false);
        expect(isVisibleCurrentUserLocation(undefined)).toBe(false);
    });

    it('returns true for real instance locations', () => {
        expect(isVisibleCurrentUserLocation('wrld_abc:12345')).toBe(true);
        expect(
            isVisibleCurrentUserLocation(
                'wrld_abc:12345~private(usr_x)~region(us)'
            )
        ).toBe(true);
    });
});

describe('mergeCurrentUserPresenceFields', () => {
    it('returns null/undefined as-is', () => {
        expect(mergeCurrentUserPresenceFields(null, null)).toBeNull();
        expect(
            mergeCurrentUserPresenceFields(undefined, undefined)
        ).toBeUndefined();
    });

    it('returns nextUser unchanged when it already has a visible location', () => {
        const nextUser = { location: 'wrld_abc:12345', displayName: 'Test' };
        const result = mergeCurrentUserPresenceFields(nextUser, null);
        expect(result).toBe(nextUser);
    });

    it('restores location fields from previousUser when nextUser has no visible location', () => {
        const nextUser = { location: 'private', displayName: 'Test' };
        const previousUser = {
            location: 'wrld_prev:99999',
            worldId: 'wrld_prev',
            instanceId: '99999',
            state: 'online',
            stateBucket: 'online'
        };

        const result = mergeCurrentUserPresenceFields(
            nextUser,
            previousUser
        ) as Record<string, unknown>;

        expect(result).not.toBeNull();
        expect(result['location']).toBe('wrld_prev:99999');
        expect(result['displayName']).toBe('Test');
    });

    it('returns nextUser when neither user has a visible location', () => {
        const nextUser = { location: 'private', displayName: 'Next' };
        const previousUser = { location: 'offline', displayName: 'Prev' };

        const result = mergeCurrentUserPresenceFields(nextUser, previousUser);

        expect((result as Record<string, unknown>)['displayName']).toBe('Next');
    });

    it('returns nextUser unchanged when previousUser is not an object', () => {
        const nextUser = { location: 'private', displayName: 'Test' };
        const result = mergeCurrentUserPresenceFields(nextUser, null);
        expect(result).toBe(nextUser);
    });
});

describe('buildCurrentUserPresenceView', () => {
    it('returns null/undefined as-is', () => {
        expect(buildCurrentUserPresenceView(null)).toBeNull();
        expect(buildCurrentUserPresenceView(undefined)).toBeUndefined();
    });

    it('returns currentUser unchanged when it already has a visible location', () => {
        const user = { location: 'wrld_abc:12345' };
        const result = buildCurrentUserPresenceView(user);
        expect(result).toBe(user);
    });

    it('applies game state patch when game is running at a real location', () => {
        const user = {
            location: 'private',
            state: 'offline',
            stateBucket: 'offline'
        };
        const gameState = {
            isGameRunning: true,
            currentLocation: 'wrld_game:99999',
            currentWorldId: 'wrld_game'
        };

        const result = buildCurrentUserPresenceView(user, {
            gameState
        }) as Record<string, unknown>;

        expect(result['location']).toBe('wrld_game:99999');
        expect(result['state']).toBe('online');
        expect(result['stateBucket']).toBe('online');
    });

    it('keeps local game location above the realtime snapshot while running', () => {
        const result = buildCurrentUserPresenceView(
            {
                location: 'wrld_profile:11111',
                state: 'offline',
                stateBucket: 'offline'
            },
            {
                currentUserSnapshot: {
                    location: 'wrld_snapshot:22222',
                    state: 'online',
                    stateBucket: 'online'
                },
                gameState: {
                    isGameRunning: true,
                    currentLocation: 'wrld_game:33333',
                    currentWorldId: 'wrld_game'
                }
            }
        ) as Record<string, unknown>;

        expect(result['location']).toBe('wrld_game:33333');
        expect(result['state']).toBe('online');
        expect(result['stateBucket']).toBe('online');
    });

    it('overlays realtime snapshot presence onto a profile with a visible location', () => {
        const user = {
            location: 'wrld_old:11111',
            state: 'offline',
            stateBucket: 'offline',
            status: 'busy',
            bio: 'Profile bio'
        };
        const snapshot = {
            location: 'wrld_live:22222',
            state: 'online',
            stateBucket: 'online',
            status: 'join me'
        };

        const result = buildCurrentUserPresenceView(user, {
            currentUserSnapshot: snapshot
        }) as Record<string, unknown>;

        expect(result).toMatchObject({
            location: 'wrld_live:22222',
            state: 'online',
            stateBucket: 'online',
            status: 'join me',
            bio: 'Profile bio'
        });
    });

    it('keeps an explicit offline snapshot from reviving stale nested API presence', () => {
        const user = {
            location: 'wrld_old:11111',
            state: 'online',
            stateBucket: 'online',
            presence: {
                world: 'wrld_old',
                instance: '11111'
            }
        };
        const snapshot = {
            location: 'offline',
            state: 'offline',
            stateBucket: 'offline'
        };

        const result = buildCurrentUserPresenceView(user, {
            currentUserSnapshot: snapshot
        }) as Record<string, unknown>;

        expect(result['location']).toBe('offline');
        expect(result['stateBucket']).toBe('offline');
    });

    it('normalizes nested API presence when the snapshot has no explicit location', () => {
        const result = buildCurrentUserPresenceView(
            {
                location: 'private',
                bio: 'Profile bio'
            },
            {
                currentUserSnapshot: {
                    state: 'online',
                    presence: {
                        world: 'wrld_snapshot',
                        instance: '33333'
                    }
                }
            }
        ) as Record<string, unknown>;

        expect(result).toMatchObject({
            location: 'wrld_snapshot:33333',
            state: 'online',
            stateBucket: 'online',
            bio: 'Profile bio'
        });
    });

    it('skips game state when gameLogDisabled is true', () => {
        const user = { location: 'private' };
        const gameState = {
            isGameRunning: true,
            currentLocation: 'wrld_game:99999',
            currentWorldId: 'wrld_game'
        };

        const result = buildCurrentUserPresenceView(user, {
            gameState,
            gameLogDisabled: true
        }) as Record<string, unknown>;

        expect(result['location']).toBe('private');
    });

    it('falls back to snapshot location when currentUser has no visible location', () => {
        const user = { location: 'private', displayName: 'Test' };
        const snapshot = {
            location: 'wrld_snapshot:11111',
            worldId: 'wrld_snapshot',
            instanceId: '11111',
            state: 'online',
            stateBucket: 'online'
        };

        const result = buildCurrentUserPresenceView(user, {
            currentUserSnapshot: snapshot
        }) as Record<string, unknown>;

        expect(result['location']).toBe('wrld_snapshot:11111');
        expect(result['displayName']).toBe('Test');
    });
});
