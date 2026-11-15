import { describe, expect, it } from 'vitest';

import { createLanguageNamer, languageShortCode } from './userLanguage';

describe('languageShortCode', () => {
    it('shortens VRChat ISO 639-3 keys to two-letter codes when one exists', () => {
        expect(languageShortCode('jpn')).toBe('JA');
        expect(languageShortCode('language_zho')).toBe('ZH');
        expect(languageShortCode('eng')).toBe('EN');
        expect(languageShortCode('')).toBe('');
    });

    it('keeps three-letter codes for languages without a distinct two-letter code', () => {
        expect(languageShortCode('ase')).toBe('ASE');
        expect(languageShortCode('yue')).toBe('YUE');
        expect(languageShortCode('cmn')).toBe('CMN');
    });
});

describe('createLanguageNamer', () => {
    const translated: Record<string, string> = {
        jsl: '日本手话',
        cmn: '普通话'
    };
    const name = createLanguageNamer('zh-CN', (key) => translated[key] ?? '');

    it('names languages in the interface language', () => {
        expect(name('jpn')).toBe('日语');
        expect(name('language_eng')).toBe('英语');
    });

    it('uses app translations for sign languages and Mandarin', () => {
        expect(name('jsl')).toBe('日本手话');
        expect(name('cmn')).toBe('普通话');
    });
});
