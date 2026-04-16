import { describe, expect, it } from 'vitest';

import {
    getAutoLoginStateLabel,
    getLoginErrorMessage,
    getLoginUserDisplayName
} from './loginDisplay.js';

describe('login display helpers', () => {
    it('shows useful error messages while keeping a fallback for unknown failures', () => {
        expect(getLoginErrorMessage(new Error('Invalid credentials'), 'Login failed')).toBe('Invalid credentials');
        expect(getLoginErrorMessage({ message: 'Ignored' }, 'Login failed')).toBe('Login failed');
        expect(getLoginErrorMessage(null, 'Login failed')).toBe('Login failed');
    });

    it('chooses the best available account label for saved accounts', () => {
        expect(getLoginUserDisplayName({ displayName: 'Display', username: 'user', id: 'usr_1' })).toBe('Display');
        expect(getLoginUserDisplayName({ username: 'user', id: 'usr_1' })).toBe('user');
        expect(getLoginUserDisplayName({ id: 'usr_1' })).toBe('usr_1');
        expect(getLoginUserDisplayName(null)).toBe('account');
    });

    it('maps auto-login states to user-facing labels', () => {
        expect(getAutoLoginStateLabel('scheduled')).toBe('Auto-login scheduled');
        expect(getAutoLoginStateLabel('running')).toBe('Auto-login running');
        expect(getAutoLoginStateLabel('success')).toBe('Auto-login succeeded');
        expect(getAutoLoginStateLabel('cancelled')).toBe('Auto-login skipped');
        expect(getAutoLoginStateLabel('throttled')).toBe('Auto-login throttled');
        expect(getAutoLoginStateLabel('expired')).toBe('Session expired');
        expect(getAutoLoginStateLabel('failed')).toBe('Auto-login failed');
        expect(getAutoLoginStateLabel('idle')).toBe('Auto-login idle');
    });
});
