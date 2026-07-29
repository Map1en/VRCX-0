import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appChangeTheme: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appChangeTheme: mocks.appChangeTheme
    }
}));

import { useShellStore } from '@/state/shellStore';

import {
    applyThemeMode,
    resolveAppCjkFontPackForLocale,
    supportsConfigurableCjkFontPack
} from './themeService';

describe('themeService theme mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useShellStore.setState({ themeMode: 'system' });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('releases a forced native theme before resolving system mode', async () => {
        let nativeTheme: 'dark' | 'system' = 'dark';
        const toggleDarkClass = vi.fn();
        const setRootAttribute = vi.fn();

        mocks.appChangeTheme.mockImplementation(async (value: number) => {
            if (value === -1) {
                nativeTheme = 'system';
            }
            return null;
        });
        vi.stubGlobal('window', {
            matchMedia: vi.fn(() => ({
                get matches() {
                    return nativeTheme === 'dark';
                }
            }))
        });
        vi.stubGlobal('document', {
            documentElement: {
                classList: {
                    toggle: toggleDarkClass
                },
                hasAttribute: vi.fn(() => false),
                setAttribute: setRootAttribute
            }
        });
        useShellStore.setState({ themeMode: 'dark' });

        await applyThemeMode('system');

        expect(mocks.appChangeTheme).toHaveBeenCalledWith(-1);
        expect(toggleDarkClass).toHaveBeenCalledWith('dark', false);
        expect(setRootAttribute).toHaveBeenCalledWith('data-theme', 'light');
        expect(useShellStore.getState().themeMode).toBe('system');
    });
});

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
        expect(supportsConfigurableCjkFontPack('de')).toBe(false);
        expect(resolveAppCjkFontPackForLocale('noto', 'en')).toBe('system');
        expect(resolveAppCjkFontPackForLocale('puhuiti', 'fr')).toBe('system');
    });
});
