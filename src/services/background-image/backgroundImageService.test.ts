import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appOpenFolderSelectorDialog: vi.fn(),
    getBool: vi.fn(),
    getString: vi.fn(),
    getRawValue: vi.fn(),
    getObject: vi.fn(),
    setBool: vi.fn(),
    setString: vi.fn(),
    setObject: vi.fn(),
    remove: vi.fn(),
    disableCommunityThemesForBackgroundImage: vi.fn(),
    registerBackgroundImageAppearanceHandlers: vi.fn(),
    applyThemeColor: vi.fn(),
    resolveThemeColor: vi.fn(),
    resolveThemeMode: vi.fn(),
    setCommunityThemeAppearanceControl: vi.fn(),
    setVrcxCssLayer: vi.fn(),
    setVrcxCssLayersSuppressed: vi.fn(),
    isBackgroundImageCustomSourceRotating: vi.fn(),
    resolveBackgroundImageCustomSnapshot: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appOpenFolderSelectorDialog: mocks.appOpenFolderSelectorDialog
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: mocks.getBool,
        getString: mocks.getString,
        getRawValue: mocks.getRawValue,
        getObject: mocks.getObject,
        setBool: mocks.setBool,
        setString: mocks.setString,
        setObject: mocks.setObject,
        remove: mocks.remove
    }
}));

vi.mock('@/services/appearanceConflictCoordinator', () => ({
    disableCommunityThemesForBackgroundImage:
        mocks.disableCommunityThemesForBackgroundImage,
    registerBackgroundImageAppearanceHandlers:
        mocks.registerBackgroundImageAppearanceHandlers
}));

vi.mock('../themeService', () => ({
    applyThemeColor: mocks.applyThemeColor,
    resolveThemeColor: mocks.resolveThemeColor,
    resolveThemeMode: mocks.resolveThemeMode,
    setCommunityThemeAppearanceControl: mocks.setCommunityThemeAppearanceControl
}));

vi.mock('../vrcx0CssLayerService', () => ({
    setVrcxCssLayer: mocks.setVrcxCssLayer,
    setVrcxCssLayersSuppressed: mocks.setVrcxCssLayersSuppressed
}));

vi.mock('./localSourceService', () => ({
    createBackgroundImageFilesSource: (
        paths: string[],
        rotationInterval = 'daily'
    ) => ({
        kind: 'files',
        paths,
        folderPath: '',
        rotationInterval
    }),
    createBackgroundImageFolderSource: (
        folderPath: string,
        rotationInterval = 'daily'
    ) => ({
        kind: 'folder',
        paths: [],
        folderPath,
        rotationInterval
    }),
    isBackgroundImageCustomSourceRotating:
        mocks.isBackgroundImageCustomSourceRotating,
    normalizeBackgroundImageCustomSource: (value: unknown) => {
        if (!value || typeof value !== 'object') {
            return null;
        }
        const source = value as Record<string, unknown>;
        const kind = source.kind === 'folder' ? 'folder' : 'files';
        const paths = Array.isArray(source.paths)
            ? source.paths.map(String).filter(Boolean)
            : [];
        const folderPath = String(source.folderPath || '').trim();
        if (kind === 'folder' && folderPath) {
            return {
                kind,
                paths: [],
                folderPath,
                rotationInterval:
                    source.rotationInterval === 'hourly' ? 'hourly' : 'daily'
            };
        }
        if (kind === 'files' && paths.length > 0) {
            return {
                kind,
                paths,
                folderPath: '',
                rotationInterval:
                    source.rotationInterval === 'hourly' ? 'hourly' : 'daily'
            };
        }
        return null;
    },
    pickBackgroundImageFiles: vi.fn(),
    resolveBackgroundImageCustomSnapshot:
        mocks.resolveBackgroundImageCustomSnapshot
}));

vi.mock('./remoteProviders', () => {
    const provider = {
        id: 'nasa-epic',
        name: 'NASA EPIC',
        priority: 1,
        enabledByDefault: true,
        cacheTtlHours: 24,
        resolveSnapshot: vi.fn()
    };
    return {
        DEFAULT_BACKGROUND_IMAGE_PROVIDER_ID: 'nasa-epic',
        backgroundImageRemoteProviders: [provider],
        resolveBackgroundImageProvider: (value: unknown) =>
            String(value || '').trim() === 'nasa-epic' ? provider : provider
    };
});

import {
    APP_THEME_CONFIG_KEYS,
    BACKGROUND_IMAGE_CONFIG_KEYS
} from '@/repositories/configKeys';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';
import { useCommunityThemeStore } from '@/state/communityThemeStore';

import {
    disableBackgroundImage,
    enableBackgroundImageCustom,
    initializeBackgroundImage,
    setBackgroundImageMode
} from './backgroundImageService';
import type {
    BackgroundImageCustomSource,
    BackgroundImageSnapshot
} from './types';

const DAILY_SNAPSHOT: BackgroundImageSnapshot = {
    mode: 'daily',
    providerId: 'nasa-epic',
    imageUrl: 'https://images.example/earth.jpg',
    title: 'Earth',
    author: 'NASA',
    license: 'NASA media usage guidelines',
    source: 'NASA EPIC',
    resolvedAt: '2026-06-08T09:30:00.000Z',
    resolvedForKey: '2026-06-08'
};

const CUSTOM_SOURCE: BackgroundImageCustomSource = {
    kind: 'files',
    paths: ['C:\\images\\one.jpg', 'C:\\images\\two.jpg'],
    folderPath: '',
    rotationInterval: 'hourly'
};

const CUSTOM_SNAPSHOT: BackgroundImageSnapshot = {
    mode: 'custom',
    sourceKind: 'files',
    imageUrl: 'asset://localhost/one.jpg',
    imagePath: 'C:\\images\\one.jpg',
    imageCount: 2,
    title: 'one.jpg',
    author: 'Custom image source',
    license: 'Local file',
    source: '2 selected images',
    resolvedAt: '2026-06-08T10:00:00.000Z',
    resolvedForKey: '2026-06-08T10'
};

function resetStores() {
    useBackgroundImageStore.getState().hydrate({
        mode: 'off',
        enabled: false,
        providerId: 'nasa-epic',
        customSource: null,
        snapshot: null
    });
    useCommunityThemeStore.getState().hydrate({
        catalogUrl: '',
        enabled: false,
        installedTheme: null,
        installedThemes: [],
        overrideCssLength: 0,
        localPreview: null
    });
}

describe('backgroundImageService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-08T10:00:00.000Z'));
        vi.clearAllMocks();
        resetStores();
        globalThis.window = {
            setTimeout: globalThis.setTimeout,
            clearTimeout: globalThis.clearTimeout
        } as unknown as Window & typeof globalThis;
        mocks.getBool.mockImplementation((key: string, fallback = false) => {
            if (key === BACKGROUND_IMAGE_CONFIG_KEYS.enabled) {
                return Promise.resolve(true);
            }
            return Promise.resolve(Boolean(fallback));
        });
        mocks.getString.mockImplementation((key: string, fallback = '') => {
            if (key === BACKGROUND_IMAGE_CONFIG_KEYS.mode) {
                return Promise.resolve('daily');
            }
            if (key === BACKGROUND_IMAGE_CONFIG_KEYS.providerId) {
                return Promise.resolve('nasa-epic');
            }
            if (key === APP_THEME_CONFIG_KEYS.themeMode) {
                return Promise.resolve('system');
            }
            if (key === APP_THEME_CONFIG_KEYS.themeColor) {
                return Promise.resolve('default');
            }
            return Promise.resolve(String(fallback ?? ''));
        });
        mocks.getRawValue.mockImplementation((key: string) =>
            Promise.resolve(
                key === BACKGROUND_IMAGE_CONFIG_KEYS.snapshots ? '{}' : null
            )
        );
        mocks.getObject.mockImplementation((key: string) => {
            if (key === BACKGROUND_IMAGE_CONFIG_KEYS.snapshots) {
                return Promise.resolve({
                    'nasa-epic': DAILY_SNAPSHOT
                });
            }
            return Promise.resolve(null);
        });
        mocks.setBool.mockResolvedValue(undefined);
        mocks.setString.mockResolvedValue(undefined);
        mocks.setObject.mockResolvedValue(undefined);
        mocks.remove.mockResolvedValue(undefined);
        mocks.disableCommunityThemesForBackgroundImage.mockResolvedValue(
            undefined
        );
        mocks.resolveThemeMode.mockReturnValue('system');
        mocks.resolveThemeColor.mockReturnValue('default');
        mocks.setCommunityThemeAppearanceControl.mockResolvedValue(undefined);
        mocks.isBackgroundImageCustomSourceRotating.mockReturnValue(false);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('initializes from a fresh cached daily snapshot and applies the background CSS layer', async () => {
        await initializeBackgroundImage();

        expect(useBackgroundImageStore.getState()).toMatchObject({
            mode: 'daily',
            enabled: true,
            providerId: 'nasa-epic',
            snapshot: DAILY_SNAPSHOT
        });
        expect(mocks.setBool).toHaveBeenCalledWith(
            BACKGROUND_IMAGE_CONFIG_KEYS.enabled,
            true
        );
        expect(mocks.setString).toHaveBeenCalledWith(
            BACKGROUND_IMAGE_CONFIG_KEYS.mode,
            'daily'
        );
        expect(mocks.setVrcxCssLayer).toHaveBeenCalledWith(
            'background-image',
            expect.stringContaining('https://images.example/earth.jpg')
        );
        expect(mocks.setVrcxCssLayersSuppressed).toHaveBeenCalledWith(
            ['installed-theme', 'local-theme-preview'],
            true
        );
        expect(mocks.setCommunityThemeAppearanceControl).toHaveBeenCalledWith(
            true
        );
        expect(
            mocks.setVrcxCssLayer.mock.invocationCallOrder[0]
        ).toBeGreaterThan(mocks.setBool.mock.invocationCallOrder[0]);
    });

    it('keeps custom mode disabled when no custom source is configured', async () => {
        useBackgroundImageStore.getState().hydrate({
            mode: 'daily',
            enabled: true,
            providerId: 'nasa-epic',
            customSource: null,
            snapshot: DAILY_SNAPSHOT
        });

        await expect(setBackgroundImageMode('custom')).resolves.toBe(false);

        expect(useBackgroundImageStore.getState()).toMatchObject({
            mode: 'custom',
            enabled: false,
            providerId: 'nasa-epic',
            customSource: null,
            snapshot: null
        });
        expect(mocks.setBool).toHaveBeenCalledWith(
            BACKGROUND_IMAGE_CONFIG_KEYS.enabled,
            false
        );
        expect(mocks.setString).toHaveBeenCalledWith(
            BACKGROUND_IMAGE_CONFIG_KEYS.mode,
            'custom'
        );
        expect(mocks.setVrcxCssLayer).toHaveBeenCalledWith(
            'background-image',
            ''
        );
        expect(mocks.setVrcxCssLayersSuppressed).toHaveBeenCalledWith(
            ['installed-theme', 'local-theme-preview'],
            false
        );
        expect(mocks.setCommunityThemeAppearanceControl).toHaveBeenCalledWith(
            false,
            'system'
        );
        expect(mocks.applyThemeColor).toHaveBeenCalledWith('default');
    });

    it('does not let a stale custom operation overwrite a newer disabled state', async () => {
        let resolveSnapshot: (snapshot: BackgroundImageSnapshot) => void = () =>
            undefined;
        const pendingSnapshot = new Promise<BackgroundImageSnapshot>(
            (resolve) => {
                resolveSnapshot = resolve;
            }
        );
        mocks.resolveBackgroundImageCustomSnapshot.mockReturnValueOnce(
            pendingSnapshot
        );

        const enablePromise = enableBackgroundImageCustom(CUSTOM_SOURCE);
        await vi.waitFor(() => {
            expect(
                mocks.resolveBackgroundImageCustomSnapshot
            ).toHaveBeenCalledOnce();
        });
        await disableBackgroundImage();
        resolveSnapshot(CUSTOM_SNAPSHOT);

        await expect(enablePromise).resolves.toBe(false);
        expect(useBackgroundImageStore.getState()).toMatchObject({
            mode: 'off',
            enabled: false,
            snapshot: null,
            loading: false
        });
    });

    it('clears the custom rotation timer when the background image is disabled', async () => {
        mocks.isBackgroundImageCustomSourceRotating.mockReturnValue(true);
        mocks.resolveBackgroundImageCustomSnapshot.mockResolvedValue(
            CUSTOM_SNAPSHOT
        );

        await expect(enableBackgroundImageCustom(CUSTOM_SOURCE)).resolves.toBe(
            true
        );
        expect(vi.getTimerCount()).toBe(1);

        await disableBackgroundImage();

        expect(vi.getTimerCount()).toBe(0);
        expect(useBackgroundImageStore.getState().enabled).toBe(false);
    });
});
