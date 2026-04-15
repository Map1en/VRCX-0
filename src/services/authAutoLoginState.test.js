import { beforeEach, describe, expect, it } from 'vitest';

import {
    AUTO_LOGIN_MAX_ATTEMPTS,
    AUTO_LOGIN_WINDOW_MS,
    canAttemptReactAutoLogin,
    getReactAutoLoginAttemptCount,
    recordReactAutoLoginAttempt,
    resetReactAutoLoginThrottle
} from './authAutoLoginState.js';

describe('authAutoLoginState', () => {
    beforeEach(() => {
        resetReactAutoLoginThrottle();
    });

    it('limits attempts per normalized account key within the throttle window', () => {
        const now = 1_000_000;

        expect(canAttemptReactAutoLogin(' user@example.com ', now)).toBe(true);
        expect(recordReactAutoLoginAttempt(' user@example.com ', now)).toBe(1);
        expect(recordReactAutoLoginAttempt('user@example.com', now + 1)).toBe(2);
        expect(recordReactAutoLoginAttempt('user@example.com', now + 2)).toBe(AUTO_LOGIN_MAX_ATTEMPTS);

        expect(canAttemptReactAutoLogin('user@example.com', now + 3)).toBe(false);
        expect(getReactAutoLoginAttemptCount('user@example.com', now + 3)).toBe(AUTO_LOGIN_MAX_ATTEMPTS);
    });

    it('keeps account buckets isolated', () => {
        const now = 2_000_000;

        recordReactAutoLoginAttempt('account-a', now);
        recordReactAutoLoginAttempt('account-a', now + 1);
        recordReactAutoLoginAttempt('account-b', now + 2);

        expect(getReactAutoLoginAttemptCount('account-a', now + 3)).toBe(2);
        expect(getReactAutoLoginAttemptCount('account-b', now + 3)).toBe(1);
    });

    it('prunes attempts after the throttle window expires', () => {
        const now = 3_000_000;

        recordReactAutoLoginAttempt('account-a', now);
        recordReactAutoLoginAttempt('account-a', now + 1);

        expect(getReactAutoLoginAttemptCount('account-a', now + AUTO_LOGIN_WINDOW_MS)).toBe(1);
        expect(getReactAutoLoginAttemptCount('account-a', now + AUTO_LOGIN_WINDOW_MS + 1)).toBe(0);
        expect(canAttemptReactAutoLogin('account-a', now + AUTO_LOGIN_WINDOW_MS + 1)).toBe(true);
    });

    it('uses a shared global bucket for blank account keys', () => {
        const now = 4_000_000;

        recordReactAutoLoginAttempt('', now);
        recordReactAutoLoginAttempt('   ', now + 1);
        recordReactAutoLoginAttempt(null, now + 2);

        expect(canAttemptReactAutoLogin(undefined, now + 3)).toBe(false);

        resetReactAutoLoginThrottle('');

        expect(canAttemptReactAutoLogin(undefined, now + 4)).toBe(true);
    });
});
