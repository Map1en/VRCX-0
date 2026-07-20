import { describe, expect, it } from 'vitest';

import { isFriendProfileLoadStatusVisible } from './statusBarFriendProfileLoad';

describe('statusBarFriendProfileLoad', () => {
    it('shows every active and terminal task state independently of dialog state', () => {
        for (const status of [
            'running',
            'cancelling',
            'completed',
            'cancelled'
        ]) {
            expect(isFriendProfileLoadStatusVisible(status)).toBe(true);
        }
        expect(isFriendProfileLoadStatusVisible('idle')).toBe(false);
    });
});
