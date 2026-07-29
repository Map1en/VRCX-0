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

function stubThemeEnvironment(prefersDark: () => boolean) {
    const toggleDarkClass = vi.fn();
    const setRootAttribute = vi.fn();

    vi.stubGlobal('window', {
        matchMedia: vi.fn(() => ({
            get matches() {
                return prefersDark();
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

    return { toggleDarkClass, setRootAttribute };
}

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
        const { toggleDarkClass, setRootAttribute } = stubThemeEnvironment(
            () => nativeTheme === 'dark'
        );

        mocks.appChangeTheme.mockImplementation(async (value: number) => {
            if (value === -1) {
                nativeTheme = 'system';
            }
            return null;
        });
        useShellStore.setState({ themeMode: 'dark' });

        await applyThemeMode('system');

        expect(mocks.appChangeTheme).toHaveBeenCalledWith(-1);
        expect(toggleDarkClass).toHaveBeenCalledWith('dark', false);
        expect(setRootAttribute).toHaveBeenCalledWith('data-theme', 'light');
        expect(useShellStore.getState().themeMode).toBe('system');
    });

    it('keeps the latest explicit theme while system sync is pending', async () => {
        let releaseSystemTheme: (() => void) | undefined;
        const { toggleDarkClass } = stubThemeEnvironment(() => false);

        mocks.appChangeTheme.mockImplementation((value: number) => {
            if (value === -1) {
                return new Promise<null>((resolve) => {
                    releaseSystemTheme = () => resolve(null);
                });
            }
            return Promise.resolve(null);
        });
        useShellStore.setState({ themeMode: 'light' });

        const pendingSystemTheme = applyThemeMode('system');
        await vi.waitFor(() =>
            expect(mocks.appChangeTheme).toHaveBeenCalledWith(-1)
        );
        const pendingDarkTheme = applyThemeMode('dark');
        releaseSystemTheme?.();
        await Promise.all([pendingSystemTheme, pendingDarkTheme]);

        expect(mocks.appChangeTheme).toHaveBeenLastCalledWith(1);
        expect(useShellStore.getState().themeMode).toBe('dark');
        expect(toggleDarkClass).toHaveBeenLastCalledWith('dark', true);
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
