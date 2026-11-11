import { describe, expect, it } from 'vitest';

import { shouldShowDeleteLog } from './notificationCenterUtils';

describe('shouldShowDeleteLog', () => {
    it.each(['friendRequest', 'ignoredFriendRequest'])(
        'allows deleting a %s only after it expired',
        (type) => {
            expect(shouldShowDeleteLog({ id: 'not_1', type })).toBe(false);
            expect(
                shouldShowDeleteLog({ id: 'not_1', type, expired: false })
            ).toBe(false);
            expect(
                shouldShowDeleteLog({ id: 'not_1', type, expired: true })
            ).toBe(true);
        }
    );

    it('allows deleting other notification types', () => {
        expect(shouldShowDeleteLog({ id: 'not_1', type: 'invite' })).toBe(true);
    });
});
