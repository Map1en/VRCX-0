import { describe, expect, it } from 'vitest';

import { getLoginUserDisplayName } from './loginDisplay';

describe('login display helpers', () => {
    it('chooses the best available account label for saved accounts', () => {
        expect(
            getLoginUserDisplayName({
                displayName: 'Display',
                username: 'user',
                id: 'usr_1'
            })
        ).toBe('Display');
        expect(getLoginUserDisplayName({ username: 'user', id: 'usr_1' })).toBe(
            'user'
        );
        expect(getLoginUserDisplayName({ id: 'usr_1' })).toBe('usr_1');
        expect(getLoginUserDisplayName(null)).toBe('account');
    });
});
