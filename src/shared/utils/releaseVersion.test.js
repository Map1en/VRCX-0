import { describe, expect, it } from 'vitest';

import {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    isBetaReleaseVersion,
    parseReleaseVersion
} from './releaseVersion.js';

describe('releaseVersion utilities', () => {
    it('parses stable and beta date versions into canonical display data', () => {
        expect(parseReleaseVersion('v2026.4.5')).toEqual({
            year: 2026,
            month: 4,
            day: 5,
            betaNumber: null,
            channel: 'Stable',
            canonicalVersion: '2026.4.5',
            displayVersion: '2026.04.05'
        });
        expect(parseReleaseVersion('2026.4.5-beta.2')).toMatchObject({
            betaNumber: 2,
            channel: 'Beta',
            canonicalVersion: '2026.4.5-beta.2',
            displayVersion: '2026.04.05-beta.2'
        });
    });

    it('rejects malformed or out-of-range versions without rewriting them for display', () => {
        expect(parseReleaseVersion('2026.13.1')).toBeNull();
        expect(parseReleaseVersion('2026.4.0')).toBeNull();
        expect(parseReleaseVersion('2026.4.5-beta.0')).toBeNull();
        expect(formatReleaseDisplayVersion('nightly')).toBe('nightly');
    });

    it('orders releases by date, then stable over beta, then beta number', () => {
        const versions = [
            '2026.4.5-beta.2',
            '2026.4.4',
            '2026.4.5',
            '2026.4.5-beta.1',
            'bad'
        ];

        expect(versions.sort(compareReleaseVersions)).toEqual([
            'bad',
            '2026.4.4',
            '2026.4.5-beta.1',
            '2026.4.5-beta.2',
            '2026.4.5'
        ]);
        expect(isBetaReleaseVersion('2026.4.5-beta.1')).toBe(true);
        expect(isBetaReleaseVersion('2026.4.5')).toBe(false);
    });
});
