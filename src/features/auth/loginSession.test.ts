import { describe, expect, it } from 'vitest';

import {
    getSnapshotLoginParams,
    sanitizeLoginRedirectTarget
} from './loginSession';

function savedCredential(id: string, username: string) {
    return {
        user: { id },
        loginParams: { username },
        hasLoginCredentials: true,
        hasCookies: false
    };
}

describe('login session helpers', () => {
    it('keeps safe in-app redirect targets and falls back for login or external targets', () => {
        expect(sanitizeLoginRedirectTarget('/feed')).toBe('/feed');
        expect(sanitizeLoginRedirectTarget('/settings/profile')).toBe(
            '/settings/profile'
        );
        expect(sanitizeLoginRedirectTarget('/login')).toBe('/feed');
        expect(sanitizeLoginRedirectTarget('/login?redirect=/settings')).toBe(
            '/feed'
        );
        expect(sanitizeLoginRedirectTarget('https://example.test')).toBe(
            '/feed'
        );
        expect(sanitizeLoginRedirectTarget(null)).toBe('/feed');
    });

    it('uses the last logged-in saved credential when available', () => {
        expect(
            getSnapshotLoginParams({
                lastUserLoggedIn: 'usr_2',
                savedCredentialsList: [
                    savedCredential('usr_1', 'first'),
                    savedCredential('usr_2', 'last')
                ]
            })
        ).toEqual({ username: 'last' });
    });

    it('falls back to the first saved credential list entry', () => {
        expect(
            getSnapshotLoginParams({
                lastUserLoggedIn: 'usr_missing',
                savedCredentialsList: [savedCredential('usr_1', 'first')]
            })
        ).toEqual({ username: 'first' });
    });

    it('returns an empty params object when no saved credential exists', () => {
        expect(getSnapshotLoginParams(null)).toEqual({});
        expect(
            getSnapshotLoginParams({
                lastUserLoggedIn: null,
                savedCredentialsList: []
            })
        ).toEqual({});
    });
});
