import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    BackgroundImageCustomSource,
    BackgroundImageProjection
} from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appBackgroundImageStateGet: vi.fn(),
    appBackgroundImageConfigure: vi.fn(),
    appBackgroundImageRefresh: vi.fn(),
    appOpenBackgroundImageFilesSelectorDialog: vi.fn(),
    appOpenFolderSelectorDialog: vi.fn(),
    convertFileSrc: vi.fn(
        (path: string, protocol: string) => `${protocol}://localhost/${path}`
    ),
    configGetString: vi.fn(),
    configSetString: vi.fn(),
    disableCommunityThemesForBackgroundImage: vi.fn(),
    registerBackgroundImageAppearanceHandlers: vi.fn(),
    syncBackgroundImageAppearance: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appBackgroundImageStateGet: mocks.appBackgroundImageStateGet,
        appBackgroundImageConfigure: mocks.appBackgroundImageConfigure,
        appBackgroundImageRefresh: mocks.appBackgroundImageRefresh,
        appOpenBackgroundImageFilesSelectorDialog:
            mocks.appOpenBackgroundImageFilesSelectorDialog,
        appOpenFolderSelectorDialog: mocks.appOpenFolderSelectorDialog
    }
}));

vi.mock('@/platform/tauri/assets', () => ({
    convertFileSrc: mocks.convertFileSrc
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: mocks.configGetString,
        setString: mocks.configSetString
    }
}));

vi.mock('@/services/appearanceConflictCoordinator', () => ({
    disableCommunityThemesForBackgroundImage:
        mocks.disableCommunityThemesForBackgroundImage,
    registerBackgroundImageAppearanceHandlers:
        mocks.registerBackgroundImageAppearanceHandlers
}));

vi.mock('./appearanceService', () => ({
    syncBackgroundImageAppearance: mocks.syncBackgroundImageAppearance
}));

import { useBackgroundImageStore } from '@/state/backgroundImageStore';

import {
    applyBackgroundImageProjectionEvent,
    disableBackgroundImage,
    initializeBackgroundImage,
    setBackgroundImageCustomRotationIntervalMinutes,
    setBackgroundImageMode
} from './backgroundImageService';

let nextRevision = 1;

function dailyProjection(
    overrides: Partial<BackgroundImageProjection> = {}
): BackgroundImageProjection {
    return {
        revision: nextRevision++,
        enabled: true,
        mode: 'daily',
        providerId: 'nasa-epic',
        customSource: null,
        snapshot: {
            mode: 'daily',
            providerId: 'nasa-epic',
            imageUrl: 'https://epic.gsfc.nasa.gov/a.jpg',
            title: 'Earth',
            author: 'NASA EPIC / DSCOVR',
            license: 'NASA media usage guidelines',
            source: 'NASA EPIC',
            resolvedAt: '2026-07-30T00:00:00.000Z',
            resolvedForKey: '2026-07-30'
        },
        error: null,
        ...overrides
    };
}

describe('backgroundImageService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.syncBackgroundImageAppearance.mockResolvedValue(undefined);
        mocks.configGetString.mockResolvedValue('');
        mocks.configSetString.mockResolvedValue(null);
        mocks.disableCommunityThemesForBackgroundImage.mockResolvedValue(
            undefined
        );
        useBackgroundImageStore.getState().setDecorationImageUrl('');
        useBackgroundImageStore.getState().applyProjection({
            mode: 'off',
            enabled: false,
            providerId: 'nasa-epic',
            customSource: null,
            snapshot: null,
            error: null
        });
    });

    it('hydrates the store from the runtime projection on initialize', async () => {
        mocks.appBackgroundImageStateGet.mockResolvedValue(dailyProjection());

        await initializeBackgroundImage();

        const state = useBackgroundImageStore.getState();
        expect(state.enabled).toBe(true);
        expect(state.mode).toBe('daily');
        expect(state.snapshot?.imageUrl).toBe(
            'https://epic.gsfc.nasa.gov/a.jpg'
        );
        expect(mocks.syncBackgroundImageAppearance).toHaveBeenCalledWith(false);
    });

    it('loads a saved grid decoration without rewriting it', async () => {
        mocks.appBackgroundImageStateGet.mockResolvedValue(
            dailyProjection({ enabled: false, mode: 'off', snapshot: null })
        );
        mocks.configGetString.mockResolvedValue(
            'https://assets.vrchat.com/www/profile_decorations/profile_backgrounds/BG_Grid.png'
        );

        await initializeBackgroundImage();

        const state = useBackgroundImageStore.getState();
        expect(state.enabled).toBe(true);
        expect(state.snapshot).toBeNull();
        expect(state.decorationImageUrl).toBe(
            'https://assets.vrchat.com/www/profile_decorations/profile_backgrounds/BG_Grid.png'
        );
        expect(mocks.configSetString).not.toHaveBeenCalled();
    });

    it('materializes a local image URL for custom snapshots', async () => {
        mocks.appBackgroundImageStateGet.mockResolvedValue(
            dailyProjection({
                mode: 'custom',
                customSource: {
                    kind: 'files',
                    paths: ['C:\\img\\a.png'],
                    folderPath: '',
                    rotationIntervalMinutes: 60
                },
                snapshot: {
                    mode: 'custom',
                    sourceKind: 'files',
                    imageUrl: '',
                    imagePath: 'C:\\img\\a.png',
                    imageCount: 1,
                    title: 'a.png',
                    author: 'Custom image source',
                    license: 'Local file',
                    source: '1 selected image',
                    resolvedAt: '2026-07-30T00:00:00.000Z',
                    resolvedForKey: 'static'
                }
            })
        );

        await initializeBackgroundImage();

        expect(useBackgroundImageStore.getState().snapshot?.imageUrl).toBe(
            'vrcx-0-bg-img://localhost/C:\\img\\a.png?v=static'
        );
    });

    it('configures a custom rotation interval in minutes', async () => {
        const customSource: BackgroundImageCustomSource = {
            kind: 'files',
            paths: ['C:\\img\\a.png', 'C:\\img\\b.png'],
            folderPath: '',
            rotationIntervalMinutes: 60
        };
        useBackgroundImageStore.getState().applyProjection({
            mode: 'custom',
            enabled: true,
            providerId: 'nasa-epic',
            customSource,
            snapshot: null,
            error: null
        });
        mocks.appBackgroundImageConfigure.mockResolvedValue(
            dailyProjection({
                mode: 'custom',
                customSource: {
                    ...customSource,
                    rotationIntervalMinutes: 180
                }
            })
        );

        await expect(
            setBackgroundImageCustomRotationIntervalMinutes(180)
        ).resolves.toBe(true);

        expect(mocks.appBackgroundImageConfigure).toHaveBeenCalledWith({
            kind: 'setRotationIntervalMinutes',
            rotationIntervalMinutes: 180
        });
    });

    it('disables community themes before applying an enabling configure result', async () => {
        mocks.appBackgroundImageConfigure.mockResolvedValue(dailyProjection());

        await expect(setBackgroundImageMode('daily')).resolves.toBe(true);

        expect(mocks.appBackgroundImageConfigure).toHaveBeenCalledWith({
            kind: 'enableDaily',
            providerId: null
        });
        expect(
            mocks.disableCommunityThemesForBackgroundImage
        ).toHaveBeenCalledTimes(1);
        expect(useBackgroundImageStore.getState().enabled).toBe(true);
    });

    it('uses the first profile decoration when the mode has no saved source', async () => {
        mocks.appBackgroundImageConfigure.mockResolvedValue(
            dailyProjection({
                enabled: false,
                mode: 'off',
                snapshot: null
            })
        );

        await expect(setBackgroundImageMode('decoration')).resolves.toBe(true);

        expect(mocks.appBackgroundImageConfigure).toHaveBeenCalledWith({
            kind: 'disable'
        });
        expect(mocks.configSetString).toHaveBeenCalledWith(
            'backgroundImageDecorationUrl',
            'https://assets.vrchat.com/www/profile_decorations/profile_backgrounds/BG_Grid.png'
        );
        expect(useBackgroundImageStore.getState().decorationImageUrl).toContain(
            'BG_Grid.png'
        );
    });

    it('keeps the community theme untouched when disabling and records errors', async () => {
        mocks.appBackgroundImageConfigure.mockResolvedValue(
            dailyProjection({ enabled: false, mode: 'off', snapshot: null })
        );

        await disableBackgroundImage({ restoreAppTheme: false });

        expect(
            mocks.disableCommunityThemesForBackgroundImage
        ).not.toHaveBeenCalled();
        expect(mocks.syncBackgroundImageAppearance).toHaveBeenCalledWith(false);
        expect(useBackgroundImageStore.getState().enabled).toBe(false);

        mocks.appBackgroundImageConfigure.mockRejectedValue(
            new Error('configure failed')
        );
        await expect(disableBackgroundImage()).rejects.toThrow(
            'configure failed'
        );
        expect(useBackgroundImageStore.getState().error).toBe(
            'configure failed'
        );
    });

    it('applies pushed projections but skips revisions already applied', async () => {
        const projection = dailyProjection();
        mocks.appBackgroundImageStateGet.mockResolvedValue(projection);
        await initializeBackgroundImage();
        mocks.syncBackgroundImageAppearance.mockClear();

        applyBackgroundImageProjectionEvent({
            ...projection,
            snapshot: {
                ...projection.snapshot!,
                imageUrl: 'https://epic.gsfc.nasa.gov/echo.jpg'
            }
        });
        expect(mocks.syncBackgroundImageAppearance).not.toHaveBeenCalled();
        expect(useBackgroundImageStore.getState().snapshot?.imageUrl).toBe(
            'https://epic.gsfc.nasa.gov/a.jpg'
        );

        const rotated = dailyProjection({
            snapshot: {
                ...projection.snapshot!,
                imageUrl: 'https://epic.gsfc.nasa.gov/b.jpg'
            }
        });
        applyBackgroundImageProjectionEvent(rotated);
        expect(useBackgroundImageStore.getState().snapshot?.imageUrl).toBe(
            'https://epic.gsfc.nasa.gov/b.jpg'
        );
    });
});
