import { describe, expect, it } from 'vitest';

import {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    parseReleaseVersion
} from './releaseVersion';

describe('releaseVersion utilities', () => {
    it('parses stable SemVer release tags', () => {
        expect(parseReleaseVersion('v1.0.0')).toEqual({
            major: 1,
            minor: 0,
            patchNumber: 0,
            betaNumber: null,
            channel: 'stable',
            buildVersion: '1.0.0',
            canonicalVersion: '1.0.0',
            displayVersion: '1.0.0'
        });
        expect(parseReleaseVersion('v1.0.1')).toMatchObject({
            major: 1,
            minor: 0,
            patchNumber: 1,
            channel: 'stable',
            buildVersion: '1.0.1',
            canonicalVersion: '1.0.1',
            displayVersion: '1.0.1'
        });
    });

    it('parses and formats beta SemVer release tags', () => {
        expect(parseReleaseVersion('v1.1.0-beta.12')).toMatchObject({
            major: 1,
            minor: 1,
            patchNumber: 0,
            betaNumber: 12,
            channel: 'beta',
            canonicalVersion: '1.1.0-beta.12',
            displayVersion: '1.1.0-beta.12'
        });
        expect(formatReleaseDisplayVersion('1.0.0')).toBe('1.0.0');
        expect(formatReleaseDisplayVersion('1.1.0-beta.12')).toBe(
            '1.1.0-beta.12'
        );
    });

    it('rejects unsupported prereleases, old date versions, and malformed values', () => {
        expect(parseReleaseVersion('v1.1.0-beta.0')).toBeNull();
        expect(parseReleaseVersion('v1.1.0-beta.1000000')).toBeNull();
        expect(parseReleaseVersion('v1.1.0-alpha.1')).toBeNull();
        expect(parseReleaseVersion('v01.1.0')).toBeNull();
        expect(parseReleaseVersion('v1.01.0')).toBeNull();
        expect(parseReleaseVersion('v1.1.01')).toBeNull();
        expect(parseReleaseVersion('v1')).toBeNull();
        expect(parseReleaseVersion('v1.1')).toBeNull();
        expect(parseReleaseVersion('v2026.4.0')).toBeNull();
        expect(parseReleaseVersion('v2026.04')).toBeNull();
        expect(parseReleaseVersion('nightly')).toBeNull();
        expect(formatReleaseDisplayVersion('nightly')).toBe('nightly');
    });

    it('orders stable releases by major, minor, then patch', () => {
        const versions = [
            '1.1.0',
            '1.2.0',
            '1.1.1',
            '1.0.0',
            '1.1.0-beta.10',
            '1.1.0-beta.2',
            'bad'
        ];

        expect(versions.sort(compareReleaseVersions)).toEqual([
            'bad',
            '1.0.0',
            '1.1.0-beta.2',
            '1.1.0-beta.10',
            '1.1.0',
            '1.1.1',
            '1.2.0'
        ]);
    });
});
