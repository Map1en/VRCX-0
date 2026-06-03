import { describe, expect, test } from 'vitest';

import {
    parseChangelog,
    parseLocalizedChangelog,
    resolvePostUpdateChangelogToastState,
    resolvePreferredChangelogLanguage
} from './changelogService';

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

        expect(parseLocalizedChangelog(body)).toEqual([
            {
                lang: 'en',
                label: 'English',
                tag: '',
                markdown: body
            }
        ]);
    });

    test('prefers exact locale, then base language, then English', () => {
        const entries = parseLocalizedChangelog(`
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
        expect(resolvePreferredChangelogLanguage(entries, 'en-US')).toBe('en');
        expect(resolvePreferredChangelogLanguage(entries, 'ja')).toBe('en');
    });

    test('shows the post-update changelog toast only once for an upgraded version', () => {
        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '',
                enabled: true
            })
        ).toEqual({
            currentVersion: '2026.06.02',
            shouldShow: true,
            shouldRecordStartedVersion: true
        });

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '2026.06.02',
                enabled: true
            }).shouldShow
        ).toBe(false);

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '',
                enabled: false
            }).shouldShow
        ).toBe(false);

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '',
                seenVersion: '',
                enabled: true
            }).shouldShow
        ).toBe(false);
    });
});
