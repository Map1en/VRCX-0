import { describe, expect, it } from 'vitest';

import { buildFavoriteGateTarget } from './useFavoritesPageController';

describe('useFavoritesPageController gate target helpers', () => {
    it('treats favorite friend active status as online for backend gate input', () => {
        expect(
            buildFavoriteGateTarget({
                id: 'usr_friend',
                key: 'remote:group:usr_friend',
                kind: 'friend',
                seedData: {
                    location: 'wrld_test:12345',
                    status: 'active'
                }
            })
        ).toEqual({
            key: 'remote:group:usr_friend',
            userId: 'usr_friend',
            location: 'wrld_test:12345',
            stateBucket: 'online',
            isCurrentUser: false
        });
    });
});
