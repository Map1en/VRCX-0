import { describe, expect, it } from 'vitest';

import {
    getLoginUserDisplayName,
    shouldShowLegacyMigrationAction
} from './loginDisplay';

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

    it('shows the legacy migration action only after loading when there are no saved accounts', () => {
        expect(shouldShowLegacyMigrationAction(true, [])).toBe(false);
        expect(
            shouldShowLegacyMigrationAction(false, [{ user: { id: 'u1' } }])
        ).toBe(false);
        expect(shouldShowLegacyMigrationAction(false, [])).toBe(true);
    });
});
