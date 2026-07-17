// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/styles/vrcx-0-rgb.css?inline', () => ({
    default: '.vrcx-0-rgb {}'
}));

const CSS_LAYER_ATTR = 'data-vrcx-0-css-layer';
const RGB_STORAGE_KEY = 'vrcx-0-rgb-enabled';
const RGB_CLASS = 'vrcx-0-rgb';

function createLocalStorage() {
    const data = new Map<string, string>();
    return {
        getItem: vi.fn((key: string) => data.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            data.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
            data.delete(key);
        })
    };
}

let localStorage = createLocalStorage();

async function loadCssLayerService() {
    vi.resetModules();
    document.head.replaceChildren();
    return import('./vrcx0CssLayerService');
}

function renderedLayers(): string[] {
    return Array.from(
        document.head.querySelectorAll(`style[${CSS_LAYER_ATTR}]`)
    ).map((element) => element.getAttribute(CSS_LAYER_ATTR) || '');
}

describe('vrcx0CssLayerService', () => {
    beforeEach(() => {
        document.head.replaceChildren();
        document.documentElement.classList.remove(RGB_CLASS);
        localStorage = createLocalStorage();
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: localStorage
        });
    });

    it('always renders RGB after every theme layer', async () => {
        const service = await loadCssLayerService();

        service.setVrcxCssLayers({
            'background-image': '.background {}',
            'installed-theme': '.installed {}',
            'local-theme-preview': '.preview {}',
            'user-override': '.override {}',
            'vrcx-0-rgb': '.rgb {}'
        });

        expect(renderedLayers()).toEqual([
            'background-image',
            'installed-theme',
            'local-theme-preview',
            'user-override',
            'vrcx-0-rgb'
        ]);

        service.setVrcxCssLayer('installed-theme', '.installed-next {}');

        expect(renderedLayers()).toEqual([
            'background-image',
            'installed-theme',
            'local-theme-preview',
            'user-override',
            'vrcx-0-rgb'
        ]);
    });

    it('keeps RGB active when image mode suppresses community themes', async () => {
        const service = await loadCssLayerService();

        service.setVrcxCssLayers({
            'background-image': '.background {}',
            'installed-theme': '.installed {}',
            'local-theme-preview': '.preview {}',
            'user-override': '.override {}',
            'vrcx-0-rgb': '.rgb {}'
        });
        service.setVrcxCssLayersSuppressed(
            ['installed-theme', 'local-theme-preview'],
            true
        );

        expect(renderedLayers()).toEqual([
            'background-image',
            'user-override',
            'vrcx-0-rgb'
        ]);
    });

    it('persists the mode and keeps repeated commands idempotent', async () => {
        const service = await loadCssLayerService();

        service.setRgb(true);
        service.setRgb(true);

        expect(localStorage.getItem(RGB_STORAGE_KEY)).toBe('true');
        expect(document.documentElement.classList.contains(RGB_CLASS)).toBe(
            true
        );
        expect(renderedLayers()).toEqual(['vrcx-0-rgb']);

        service.setRgb(false);

        expect(localStorage.getItem(RGB_STORAGE_KEY)).toBeNull();
        expect(document.documentElement.classList.contains(RGB_CLASS)).toBe(
            false
        );
        expect(renderedLayers()).toEqual([]);
    });

    it('restores the mode when the CSS layer module loads', async () => {
        localStorage.setItem(RGB_STORAGE_KEY, 'true');

        await loadCssLayerService();

        expect(document.documentElement.classList.contains(RGB_CLASS)).toBe(
            true
        );
        expect(renderedLayers()).toEqual(['vrcx-0-rgb']);
    });

    it('keeps the current session active when storage is unavailable', async () => {
        const service = await loadCssLayerService();
        localStorage.setItem.mockImplementationOnce(() => {
            throw new Error('storage unavailable');
        });

        expect(() => service.setRgb(true)).not.toThrow();
        expect(document.documentElement.classList.contains(RGB_CLASS)).toBe(
            true
        );
        expect(renderedLayers()).toEqual(['vrcx-0-rgb']);
    });
});
