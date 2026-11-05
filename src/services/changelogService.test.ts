import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { NormalizedRelease } from '@/services/updateService';

const mocks = vi.hoisted(() => ({
    fetchBranchReleasePage: vi.fn()
}));

vi.mock('@/services/updateService', () => ({
    fetchBranchReleasePage: mocks.fetchBranchReleasePage
}));

import {
    buildChangelogSections,
    fetchChangelogReleases,
    findChangelogRelease,
    parseChangelog,
    parseReleaseChangelog,
    resolvePostUpdateChangelogToastState,
    resolvePreferredChangelogLanguage
} from './changelogService';

function stableRelease(version: string, body = ''): NormalizedRelease {
    return {
        canonicalVersion: version,
        channel: 'stable',
        displayVersion: version,
        htmlUrl: `https://example.test/v${version}`,
        tagName: `v${version}`,
        displayName: `VRCX-0 ${version}`,
        publishedAt: '2026-10-26T00:00:00Z',
        body,
        updaterType: 'manual'
    };
}

describe('changelog release list', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('keeps fetching pages until ten releases of the channel are collected', async () => {
        const versions = Array.from(
            { length: 12 },
            (_, index) => `2.${40 - index}.0`
        );
        mocks.fetchBranchReleasePage
            .mockResolvedValueOnce({
                releases: versions.slice(0, 6).map((v) => stableRelease(v)),
                hasMore: true
            })
            .mockResolvedValueOnce({
                releases: versions.slice(6).map((v) => stableRelease(v)),
                hasMore: true
            });

        const releases = await fetchChangelogReleases('2.40.0');

        expect(releases.map((release) => release.canonicalVersion)).toEqual(
            versions.slice(0, 10)
        );
        expect(mocks.fetchBranchReleasePage.mock.calls).toEqual([
            ['stable', 1],
            ['stable', 2]
        ]);
    });

    test('stops at the last GitHub page and uses the beta channel for beta builds', async () => {
        mocks.fetchBranchReleasePage.mockResolvedValueOnce({
            releases: [],
            hasMore: false
        });

        const releases = await fetchChangelogReleases('v2.34.0-beta.3');

        expect(releases).toEqual([]);
        expect(mocks.fetchBranchReleasePage.mock.calls).toEqual([['beta', 1]]);
    });

    test('finds the target release by version or tag', () => {
        const releases = [stableRelease('2.33.0'), stableRelease('2.32.0')];

        expect(findChangelogRelease(releases, 'v2.32.0')).toBe(releases[1]);
        expect(findChangelogRelease(releases, '2.31.0')).toBeNull();
        expect(findChangelogRelease(releases, '')).toBeNull();
    });

    test('drops the leading version line that repeats the section heading', () => {
        const [section] = buildChangelogSections([
            stableRelease(
                '2.32.0',
                `<!-- vrcx-0-changelog:start tag=vrcx-0-v2320-en -->
v2.32.0
**What's New:**
<!-- vrcx-0-changelog:end -->`
            )
        ]);

        expect(section.id).toBe('2.32.0');
        expect(section.entries[0].markdown).toBe("**What's New:**");
    });
});

describe('changelogService', () => {
    test('parses localized release body marker blocks and the global note', () => {
        const body = `
<!-- vrcx-0-changelog:note
This release focuses on the changelog page.
-->

<!-- vrcx-0-changelog:start tag=vrcx-0-v240-en -->
### English
- Added the changelog dialog.
<!-- vrcx-0-changelog:end -->

<!-- vrcx-0-changelog:start tag=vrcx-0-v240-zh-CN -->
### 简体中文
- 新增更新内容对话框。
<!-- vrcx-0-changelog:end -->
`;

        expect(parseChangelog(body)).toEqual({
            note: 'This release focuses on the changelog page.',
            entries: [
                {
                    lang: 'en',
                    label: 'English',
                    tag: 'vrcx-0-v240-en',
                    markdown: '### English\n- Added the changelog dialog.'
                },
                {
                    lang: 'zh-CN',
                    label: '简体中文',
                    tag: 'vrcx-0-v240-zh-CN',
                    markdown: '### 简体中文\n- 新增更新内容对话框。'
                }
            ]
        });
    });

    test('falls back to the full release body when marker blocks are absent', () => {
        const body = '### Changes\n\n- Fixed updater flow.';

        expect(parseChangelog(body).entries).toEqual([
            {
                lang: 'en',
                label: 'English',
                tag: '',
                markdown: body
            }
        ]);
    });

    test('uses the complete beta release note as one English changelog', () => {
        const body = `<!-- vrcx-0-changelog:note hidden -->
### Beta changes

- Fixed the updater.`;

        expect(
            parseReleaseChangelog({
                canonicalVersion: '2.8.0-beta.1',
                channel: 'beta',
                displayVersion: '2.8.0-beta.1',
                htmlUrl: 'https://example.test/v2.8.0-beta.1',
                tagName: 'v2.8.0-beta.1',
                displayName: 'VRCX-0 2.8.0-beta.1',
                publishedAt: '2026-09-04T00:00:00Z',
                body,
                updaterType: 'manual'
            })
        ).toEqual({
            note: '',
            entries: [
                {
                    lang: 'en',
                    label: 'English',
                    tag: '',
                    markdown: body
                }
            ]
        });
    });

    test('merges duplicate language blocks into one tab entry', () => {
        const body = `
<!-- vrcx-0-changelog:start tag=vrcx-0-v240-en -->
First English section.
<!-- vrcx-0-changelog:end -->
<!-- vrcx-0-changelog:start tag=vrcx-0-v241-EN -->
Second English section.
<!-- vrcx-0-changelog:end -->
`;

        expect(parseChangelog(body).entries).toEqual([
            {
                lang: 'en',
                label: 'English',
                tag: 'vrcx-0-v240-en',
                markdown: 'First English section.\n\nSecond English section.'
            }
        ]);
    });

    test('prefers exact locale, then base language, then English', () => {
        const { entries } = parseChangelog(`
<!-- vrcx-0-changelog:start tag=vrcx-0-v240-en -->
English body
<!-- vrcx-0-changelog:end -->
<!-- vrcx-0-changelog:start tag=vrcx-0-v240-zh-CN -->
中文内容
<!-- vrcx-0-changelog:end -->
`);

        expect(resolvePreferredChangelogLanguage(entries, 'zh-CN')).toBe(
            'zh-CN'
        );
        expect(resolvePreferredChangelogLanguage(entries, 'zh-cn')).toBe(
            'zh-CN'
        );
        expect(resolvePreferredChangelogLanguage(entries, 'zh_CN')).toBe(
            'zh-CN'
        );
        expect(resolvePreferredChangelogLanguage(entries, 'en-US')).toBe('en');
        expect(resolvePreferredChangelogLanguage(entries, 'ja')).toBe('en');
    });

    test('shows the post-update changelog only once for an upgraded version', () => {
        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '',
                autoOpen: true
            })
        ).toEqual({
            currentVersion: '2026.06.02',
            autoOpen: true,
            shouldShow: true,
            shouldRecordStartedVersion: true
        });

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '2026.06.02',
                autoOpen: true
            }).shouldShow
        ).toBe(false);

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '',
                autoOpen: false
            })
        ).toMatchObject({ autoOpen: false, shouldShow: true });

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '',
                seenVersion: '',
                autoOpen: true
            }).shouldShow
        ).toBe(false);
    });
});
