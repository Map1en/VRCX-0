import { describe, expect, it } from 'vitest';

import en from '@/localization/en.json';
import ja from '@/localization/ja.json';
import zhCN from '@/localization/zh-CN.json';

import {
    buildSettingsSearchIndex,
    normalizeSettingsSearchText,
    searchSettingsIndex
} from './settingsSearch';

function translatorFor(messages: unknown) {
    return (key: string) => {
        let node = messages;
        for (const part of key.split('.')) {
            node =
                node && typeof node === 'object'
                    ? (node as Record<string, unknown>)[part]
                    : undefined;
        }
        return typeof node === 'string' ? node : key;
    };
}

const englishT = translatorFor(en);

const WINDOWS_CONTEXT = {
    platform: 'windows',
    gameLogIngest: true,
    updateCheckDisabledBuild: false
};

function searchIds(locale: unknown, query: string, context = WINDOWS_CONTEXT) {
    const index = buildSettingsSearchIndex(
        [translatorFor(locale), englishT],
        context
    );
    return searchSettingsIndex(index, query).map((entry) => entry.id);
}

describe('settings search', () => {
    it('normalizes width variants and folds katakana into hiragana', () => {
        expect(normalizeSettingsSearchText('ＰＲＯＸＹ　ﾌﾟﾛｷｼ')).toBe(
            'proxy ぷろきし'
        );
    });

    it('matches the current language label', () => {
        expect(searchIds(zhCN, '代理服务器')[0]).toBe('system.network.proxy');
    });

    it('matches the English label while another language is active', () => {
        expect(searchIds(zhCN, 'proxy')).toContain('system.network.proxy');
        expect(searchIds(ja, 'Wrist Feed Overlay')[0]).toBe('vr.wrist.enabled');
    });

    it('treats hiragana, katakana and half-width katakana as the same text', () => {
        for (const query of ['ぷろきし', 'プロキシ', 'ﾌﾟﾛｷｼ']) {
            expect(searchIds(ja, query)).toContain('system.network.proxy');
        }
    });

    it('requires every query token to match', () => {
        const ids = searchIds(en, 'wrist size');

        expect(ids).toContain('vr.wrist.size');
        expect(ids).not.toContain('vr.wrist.enabled');
    });

    it('ranks label matches above card or tab matches', () => {
        const ids = searchIds(en, 'position');

        expect(ids[0]).toBe('vr.hmd.position');
    });

    it('returns nothing for a blank query', () => {
        expect(searchIds(en, '   ')).toEqual([]);
    });

    it('hides settings the current platform does not render', () => {
        const linux = { ...WINDOWS_CONTEXT, platform: 'linux' };

        expect(searchIds(en, 'Window Compatibility')).toContain(
            'system.window.system-window-frame'
        );
        expect(searchIds(en, 'Window Compatibility', linux)).not.toContain(
            'system.window.system-window-frame'
        );
        expect(searchIds(en, 'WayVR', linux)).toContain(
            'vr.notifications.xsoverlay'
        );
    });
});
