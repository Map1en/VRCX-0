import { describe, expect, test } from 'vitest';

import {
    parseLocalizedChangelog,
    resolvePostUpdateChangelogToastState,
    resolvePreferredChangelogLanguage
} from './changelogService';

describe('changelogService', () => {
    test('parses localized release body marker blocks', () => {
        const body = `
[English](#vrcx-changelog-en) | [简体中文](#vrcx-changelog-zh-cn)

<!-- vrcx-changelog:start lang=en label="English" anchor="vrcx-changelog-en" -->
<a name="vrcx-changelog-en"></a>

### English
- Added the changelog dialog.
<!-- vrcx-changelog:end -->

<!-- vrcx-changelog:start lang=zh-CN label="简体中文" anchor="vrcx-changelog-zh-cn" -->
<a name="vrcx-changelog-zh-cn"></a>

### 简体中文
- 新增更新内容对话框。
<!-- vrcx-changelog:end -->
`;

        expect(parseLocalizedChangelog(body)).toEqual([
            {
                lang: 'en',
                label: 'English',
                anchor: 'vrcx-changelog-en',
                markdown: '### English\n- Added the changelog dialog.'
            },
            {
                lang: 'zh-CN',
                label: '简体中文',
                anchor: 'vrcx-changelog-zh-cn',
                markdown: '### 简体中文\n- 新增更新内容对话框。'
            }
        ]);
    });

    test('falls back to the full release body when marker blocks are absent', () => {
        const body = '### Changes\n\n- Fixed updater flow.';

        expect(parseLocalizedChangelog(body)).toEqual([
            {
                lang: 'en',
                label: 'English',
                anchor: '',
                markdown: body
            }
        ]);
    });

    test('prefers exact locale, then base language, then English', () => {
        const entries = parseLocalizedChangelog(`
<!-- vrcx-changelog:start lang=en label="English" anchor="en" -->
English body
<!-- vrcx-changelog:end -->
<!-- vrcx-changelog:start lang=zh-CN label="简体中文" anchor="zh-cn" -->
中文内容
<!-- vrcx-changelog:end -->
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
