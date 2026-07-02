import { describe, expect, it } from 'vitest';

import cs from './cs.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import hu from './hu.json';
import ja from './ja.json';
import ko from './ko.json';
import localeCases from './locale-cases.json';
import { languageCodes, normalizeLanguageCode } from './locales';
import pl from './pl.json';
import pt from './pt.json';
import ru from './ru.json';
import th from './th.json';
import vi from './vi.json';
import zhCn from './zh-CN.json';
import zhTw from './zh-TW.json';

const localeSources: Record<string, unknown> = {
    cs,
    en,
    es,
    fr,
    hu,
    ja,
    ko,
    pl,
    pt,
    ru,
    th,
    vi,
    'zh-CN': zhCn,
    'zh-TW': zhTw
};

describe('normalizeLanguageCode', () => {
    it('keeps exact supported language codes', () => {
        expect(normalizeLanguageCode('en')).toBe('en');
        expect(normalizeLanguageCode('ja')).toBe('ja');
        expect(normalizeLanguageCode('zh-CN')).toBe('zh-CN');
        expect(normalizeLanguageCode('zh-TW')).toBe('zh-TW');
    });

    it('maps regional system languages to supported app languages', () => {
        expect(normalizeLanguageCode('en-US')).toBe('en');
        expect(normalizeLanguageCode('ja-JP')).toBe('ja');
        expect(normalizeLanguageCode('ko-KR')).toBe('ko');
        expect(normalizeLanguageCode('pt-BR')).toBe('pt');
    });

    it('normalizes underscore separators from host locale values', () => {
        expect(normalizeLanguageCode('en_US')).toBe('en');
        expect(normalizeLanguageCode('zh_Hant_TW')).toBe('zh-TW');
    });

    it('maps simplified and traditional Chinese system locales explicitly', () => {
        expect(normalizeLanguageCode('zh')).toBe('zh-CN');
        expect(normalizeLanguageCode('zh-Hans')).toBe('zh-CN');
        expect(normalizeLanguageCode('zh-Hans-CN')).toBe('zh-CN');
        expect(normalizeLanguageCode('zh-SG')).toBe('zh-CN');
        expect(normalizeLanguageCode('zh-Hant')).toBe('zh-TW');
        expect(normalizeLanguageCode('zh-Hant-HK')).toBe('zh-TW');
        expect(normalizeLanguageCode('zh-HK')).toBe('zh-TW');
    });

    it('falls back to English for unsupported or empty languages', () => {
        expect(normalizeLanguageCode('de-DE')).toBe('en');
        expect(normalizeLanguageCode('')).toBe('en');
        expect(normalizeLanguageCode(null)).toBe('en');
    });

    it('matches the shared Rust normalization cases', () => {
        for (const localeCase of localeCases) {
            expect(normalizeLanguageCode(localeCase.input)).toBe(
                localeCase.expected
            );
        }
    });
});

describe('native shell locale coverage', () => {
    const requiredMenuKeys = [
        'nativeShell.menu.app.title',
        'nativeShell.menu.app.about',
        'nativeShell.menu.app.settings',
        'nativeShell.menu.app.checkUpdates',
        'nativeShell.menu.app.restart',
        'nativeShell.menu.app.startBackgroundMode',
        'nativeShell.menu.app.logout',
        'nativeShell.menu.app.quit',
        'nativeShell.menu.view.title',
        'nativeShell.menu.view.notificationCenter',
        'nativeShell.menu.view.quickSearch',
        'nativeShell.menu.view.directAccess',
        'nativeShell.menu.view.toggleNav',
        'nativeShell.menu.view.toggleFriendsSidebar',
        'nativeShell.menu.view.customNav',
        'nativeShell.menu.view.themes',
        'nativeShell.menu.view.zoomIn',
        'nativeShell.menu.view.zoomOut',
        'nativeShell.menu.view.resetZoom',
        'nativeShell.menu.edit.title',
        'nativeShell.menu.edit.undo',
        'nativeShell.menu.edit.redo',
        'nativeShell.menu.edit.cut',
        'nativeShell.menu.edit.copy',
        'nativeShell.menu.edit.paste',
        'nativeShell.menu.edit.selectAll',
        'nativeShell.menu.tools.title',
        'nativeShell.menu.tools.allTools',
        'nativeShell.menu.window.title',
        'nativeShell.menu.window.minimize',
        'nativeShell.menu.window.maximize',
        'nativeShell.menu.window.close',
        'nativeShell.menu.help.title',
        'nativeShell.menu.help.changelog',
        'nativeShell.menu.help.keyboardShortcuts',
        'nativeShell.menu.help.reportIssue',
        'nativeShell.menu.help.github',
        'nativeShell.menu.help.discord',
        'nativeShell.menu.help.qqGroup',
        'nativeShell.menu.help.openDevtools',
        'nativeShell.menu.help.supportVrcx'
    ];

    it('keeps native shell menu labels in every locale source file', () => {
        for (const locale of languageCodes) {
            const source = readLocaleSource(locale);
            for (const key of requiredMenuKeys) {
                const value = readPath(source, key);
                expect(value, `${locale} ${key}`).toEqual(expect.any(String));
                if (typeof value !== 'string') {
                    continue;
                }
                expect(value.trim()).not.toBe('');
                expect(value).not.toBe(key);
            }
        }
    });
});

function readLocaleSource(locale: string): unknown {
    return localeSources[locale];
}

function readPath(source: unknown, keyPath: string): unknown {
    return keyPath.split('.').reduce<unknown>((value, key) => {
        if (isRecord(value) && key in value) {
            return value[key];
        }
        return undefined;
    }, source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
