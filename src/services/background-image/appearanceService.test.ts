// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundImageSnapshot } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    backgroundState: {
        enabled: false,
        decorationImageUrl: '',
        snapshot: null as BackgroundImageSnapshot | null
    },
    setCommunityThemeAppearanceControl: vi.fn(),
    setVrcxCssLayer: vi.fn(),
    setVrcxCssLayersSuppressed: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn()
    }
}));

vi.mock('@/state/backgroundImageStore', () => ({
    useBackgroundImageStore: {
        getState: () => mocks.backgroundState
    }
}));

vi.mock('@/state/communityThemeStore', () => ({
    communityThemeControlsAppearance: vi.fn(() => false),
    useCommunityThemeStore: {
        getState: () => ({
            enabled: false,
            installedTheme: null,
            localPreview: null
        })
    }
}));

vi.mock('../themeService', () => ({
    applyThemeColor: vi.fn(),
    resolveThemeColor: vi.fn(),
    resolveThemeMode: vi.fn(),
    setCommunityThemeAppearanceControl: mocks.setCommunityThemeAppearanceControl
}));

vi.mock('../vrcx0CssLayerService', () => ({
    setVrcxCssLayer: mocks.setVrcxCssLayer,
    setVrcxCssLayersSuppressed: mocks.setVrcxCssLayersSuppressed
}));

import { syncBackgroundImageAppearance } from './appearanceService';

class LoadedImage {
    complete = true;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;

    set src(_value: string) {}
}

function snapshot(imageUrl: string): BackgroundImageSnapshot {
    return {
        mode: 'daily',
        providerId: 'nasa-epic',
        imageUrl,
        title: 'Background',
        author: 'Author',
        license: 'Public domain',
        source: 'Source',
        resolvedAt: '2026-08-24T00:00:00.000Z',
        resolvedForKey: '2026-08-24'
    };
}

describe('background image appearance', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.stubGlobal('Image', LoadedImage);
        document.documentElement.classList.remove('reduce-effects');
        document.body.innerHTML =
            '<div class="vrcx-0-background-image-transition-layer"></div>';
        mocks.backgroundState.enabled = false;
        mocks.backgroundState.decorationImageUrl = '';
        mocks.backgroundState.snapshot = null;
        await syncBackgroundImageAppearance(false);
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('crossfades between resolved images and commits the new base layer', async () => {
        mocks.backgroundState.enabled = true;
        mocks.backgroundState.snapshot = snapshot('https://example.com/a.jpg');
        await syncBackgroundImageAppearance(false);

        mocks.setVrcxCssLayer.mockClear();
        mocks.backgroundState.snapshot = snapshot('https://example.com/b.jpg');
        const transition = syncBackgroundImageAppearance(false);
        await Promise.resolve();
        await Promise.resolve();

        const transitionLayer = document.querySelector<HTMLElement>(
            '.vrcx-0-background-image-transition-layer'
        );
        expect(transitionLayer?.hasAttribute('data-active')).toBe(true);
        expect(transitionLayer?.style.backgroundImage).toContain(
            'https://example.com/b.jpg'
        );
        expect(mocks.setVrcxCssLayer).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(280);
        await transition;

        expect(mocks.setVrcxCssLayer).toHaveBeenCalledWith(
            'background-image',
            expect.stringContaining('https://example.com/b.jpg')
        );
        expect(mocks.setVrcxCssLayer).toHaveBeenCalledWith(
            'background-image',
            expect.stringContaining('--vrcx-0-app-surface: transparent;')
        );
        expect(transitionLayer?.hasAttribute('data-active')).toBe(false);
        expect(transitionLayer?.style.backgroundImage).toBe('');
    });

    it('switches immediately when reduced effects are enabled', async () => {
        mocks.backgroundState.enabled = true;
        mocks.backgroundState.snapshot = snapshot('https://example.com/a.jpg');
        await syncBackgroundImageAppearance(false);
        mocks.setVrcxCssLayer.mockClear();
        document.documentElement.classList.add('reduce-effects');
        mocks.backgroundState.snapshot = snapshot('https://example.com/b.jpg');

        await syncBackgroundImageAppearance(false);

        expect(mocks.setVrcxCssLayer).toHaveBeenCalledWith(
            'background-image',
            expect.stringContaining('https://example.com/b.jpg')
        );
    });

    it('applies a decoration URL without a backend snapshot', async () => {
        mocks.backgroundState.enabled = true;
        mocks.backgroundState.decorationImageUrl =
            'https://assets.vrchat.com/profile-background.png';

        await syncBackgroundImageAppearance(false);

        expect(mocks.setVrcxCssLayer).toHaveBeenCalledWith(
            'background-image',
            expect.stringMatching(
                /https:\/\/assets\.vrchat\.com\/profile-background\.png[\s\S]*--vrcx-0-app-surface: var\(--background\);/
            )
        );
    });
});
