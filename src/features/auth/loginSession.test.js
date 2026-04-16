import { describe, expect, it } from 'vitest';

import {
    getSnapshotLoginParams,
    sanitizeLoginRedirectTarget
} from './loginSession.js';

describe('login session helpers', () => {
    it('keeps safe in-app redirect targets and falls back for login or external targets', () => {
        expect(sanitizeLoginRedirectTarget('/feed')).toBe('/feed');
        expect(sanitizeLoginRedirectTarget('/settings/profile')).toBe('/settings/profile');
        expect(sanitizeLoginRedirectTarget('/login')).toBe('/feed');
        expect(sanitizeLoginRedirectTarget('/login?redirect=/settings')).toBe('/feed');
        expect(sanitizeLoginRedirectTarget('https://example.test')).toBe('/feed');
        expect(sanitizeLoginRedirectTarget(null)).toBe('/feed');
    });

    it('uses the last logged-in saved credential when available', () => {
        expect(
            getSnapshotLoginParams({
                lastUserLoggedIn: 'usr_2',
                savedCredentials: {
                    usr_1: { loginParams: { username: 'first' } },
                    usr_2: { loginParams: { username: 'last' } }
                },
                savedCredentialsList: [{ loginParams: { username: 'fallback' } }]
            })
        ).toEqual({ username: 'last' });
    });

    it('falls back to the first saved credential list entry', () => {
        expect(
            getSnapshotLoginParams({
                lastUserLoggedIn: 'usr_missing',
                savedCredentials: {},
                savedCredentialsList: [{ loginParams: { username: 'first' } }]
            })
        ).toEqual({ username: 'first' });
    });

    it('returns an empty params object when no saved credential exists', () => {
        expect(getSnapshotLoginParams(null)).toEqual({});
        expect(getSnapshotLoginParams({ savedCredentialsList: [] })).toEqual({});
    });
});
