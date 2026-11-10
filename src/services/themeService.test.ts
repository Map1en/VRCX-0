import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setWindowTheme: vi.fn(),
    setZoom: vi.fn<(zoom: number) => Promise<void>>()
}));

vi.mock(import('@/platform/tauri/webview'), async (importOriginal) => ({
    ...(await importOriginal()),
    setWindowTheme: mocks.setWindowTheme
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: { webview: { setZoom: mocks.setZoom } }
}));

import { useShellStore } from '@/state/shellStore';

import {
    applyThemeMode,
    applyZoomLevel,
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

        mocks.setWindowTheme.mockImplementation(
            async (value: string | null) => {
                if (value === null) {
                    nativeTheme = 'system';
                }
                return null;
            }
        );
        useShellStore.setState({ themeMode: 'dark' });

        await applyThemeMode('system');

        expect(mocks.setWindowTheme).toHaveBeenCalledWith(null);
        expect(toggleDarkClass).toHaveBeenCalledWith('dark', false);
        expect(setRootAttribute).toHaveBeenCalledWith('data-theme', 'light');
        expect(useShellStore.getState().themeMode).toBe('system');
    });

    it('keeps the latest explicit theme while system sync is pending', async () => {
        let releaseSystemTheme: (() => void) | undefined;
        const { toggleDarkClass } = stubThemeEnvironment(() => false);

        mocks.setWindowTheme.mockImplementation((value: string | null) => {
            if (value === null) {
                return new Promise<null>((resolve) => {
                    releaseSystemTheme = () => resolve(null);
                });
            }
            return Promise.resolve(null);
        });
        useShellStore.setState({ themeMode: 'light' });

        const pendingSystemTheme = applyThemeMode('system');
        await vi.waitFor(() =>
            expect(mocks.setWindowTheme).toHaveBeenCalledWith(null)
        );
        const pendingDarkTheme = applyThemeMode('dark');
        releaseSystemTheme?.();
        await Promise.all([pendingSystemTheme, pendingDarkTheme]);

        expect(mocks.setWindowTheme).toHaveBeenLastCalledWith('dark');
        expect(useShellStore.getState().themeMode).toBe('dark');
        expect(toggleDarkClass).toHaveBeenLastCalledWith('dark', true);
    });
});

describe('themeService zoom level', () => {
    beforeEach(() => {
        mocks.setZoom.mockReset().mockResolvedValue(undefined);
    });

    it('applies the zoom level as a percentage of the webview scale', async () => {
        await applyZoomLevel(125);

        expect(mocks.setZoom).toHaveBeenLastCalledWith(1.25);
        expect(useShellStore.getState().zoomLevel).toBe(125);
    });

    it('clamps the zoom level to 50–200 percent', async () => {
        await applyZoomLevel(300);
        expect(mocks.setZoom).toHaveBeenLastCalledWith(2);
        expect(useShellStore.getState().zoomLevel).toBe(200);

        await applyZoomLevel(30);
        expect(mocks.setZoom).toHaveBeenLastCalledWith(0.5);
        expect(useShellStore.getState().zoomLevel).toBe(50);
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
