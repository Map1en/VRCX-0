import { describe, expect, it } from 'vitest';

import {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    isBetaReleaseVersion,
    parseReleaseVersion
} from './releaseVersion.js';

describe('releaseVersion utilities', () => {
    it('parses stable and beta monthly versions into canonical display data', () => {
        expect(parseReleaseVersion('v2026.04')).toEqual({
            year: 2026,
            month: 4,
            patchNumber: 0,
            betaNumber: null,
            channel: 'Stable',
            canonicalVersion: '2026.4.0',
            displayVersion: '2026.04'
        });
        expect(parseReleaseVersion('2026.4.1')).toMatchObject({
            patchNumber: 1,
            canonicalVersion: '2026.4.1',
            displayVersion: '2026.04.1'
        });
        expect(parseReleaseVersion('2026.4.0-beta.12')).toMatchObject({
            patchNumber: 0,
            betaNumber: 12,
            channel: 'Beta',
            canonicalVersion: '2026.4.0-beta.12',
            displayVersion: '2026.04-beta.12'
        });
        expect(parseReleaseVersion('v2026.04-beta.2')).toMatchObject({
            betaNumber: 2,
            channel: 'Beta',
            canonicalVersion: '2026.4.0-beta.2',
            displayVersion: '2026.04-beta.2'
        });
    });

    it('rejects malformed or out-of-range versions without rewriting them for display', () => {
        expect(parseReleaseVersion('2026.13.1')).toBeNull();
        expect(parseReleaseVersion('2026.4.-1')).toBeNull();
        expect(parseReleaseVersion('2026.4-beta.0')).toBeNull();
        expect(formatReleaseDisplayVersion('nightly')).toBe('nightly');
    });

    it('orders releases by year, month, patch, then stable over beta', () => {
        const versions = [
            '2026.4.0-beta.2',
            '2026.4.1',
            '2026.4.0',
            '2026.5.0-beta.1',
            '2026.4.0-beta.1',
            'bad'
        ];

        expect(versions.sort(compareReleaseVersions)).toEqual([
            'bad',
            '2026.4.0-beta.1',
            '2026.4.0-beta.2',
            '2026.4.0',
            '2026.4.1',
            '2026.5.0-beta.1'
        ]);
        expect(isBetaReleaseVersion('2026.4.0-beta.1')).toBe(true);
        expect(isBetaReleaseVersion('2026.4.0')).toBe(false);
    });
});
