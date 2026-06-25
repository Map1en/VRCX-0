import { describe, expect, it } from 'vitest';

import {
    resolveAppCjkFontPackForLocale,
    supportsConfigurableCjkFontPack
} from './themeService';

describe('themeService CJK font locale routing', () => {
    it('allows configurable CJK font packs for core CJK locales', () => {
        expect(supportsConfigurableCjkFontPack('zh-CN')).toBe(true);
        expect(supportsConfigurableCjkFontPack('zh-TW')).toBe(true);
        expect(supportsConfigurableCjkFontPack('zh-Hans')).toBe(true);
        expect(supportsConfigurableCjkFontPack('zh-Hant-TW')).toBe(true);
        expect(supportsConfigurableCjkFontPack('ja')).toBe(true);
        expect(supportsConfigurableCjkFontPack('ko')).toBe(true);
        expect(resolveAppCjkFontPackForLocale('puhuiti', 'ja')).toBe('puhuiti');
    });

    it('uses the system CJK font for non-core CJK app locales', () => {
        expect(supportsConfigurableCjkFontPack('en')).toBe(false);
        expect(supportsConfigurableCjkFontPack('fr')).toBe(false);
        expect(supportsConfigurableCjkFontPack('vi')).toBe(false);
        expect(resolveAppCjkFontPackForLocale('noto', 'en')).toBe('system');
        expect(resolveAppCjkFontPackForLocale('puhuiti', 'fr')).toBe('system');
    });
});
