import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CATALOG_URL = 'https://themes.example.test/index.json';
const CSS_FILE_NAME = 'theme.css';

const mocks = vi.hoisted(() => ({
    convertFileSrc: vi.fn(),
    appRefreshTrayMenu: vi.fn(),
    appCommunityThemeDebugLoadLocalTheme: vi.fn(),
    loadCommunityThemeCatalog: vi.fn(),
    loadCommunityThemeCss: vi.fn(),
    resolveCommunityThemeAssetUrl: vi.fn(),
    getBool: vi.fn(),
    getString: vi.fn(),
    getObject: vi.fn(),
    getRawValue: vi.fn(),
    setBool: vi.fn(),
    setString: vi.fn(),
    setMany: vi.fn(),
    remove: vi.fn(),
    isDevToolsBuild: vi.fn(),
    disableBackgroundImage: vi.fn(),
    isBackgroundImageActive: vi.fn(),
    migrateLegacyNasaApodCommunityTheme: vi.fn(),
    applyThemeColor: vi.fn(),
    resolveThemeMode: vi.fn(),
    clearThemeColorInlineProperties: vi.fn(),
    resolveThemeColor: vi.fn(),
    setCommunityThemeAppearanceControl: vi.fn(),
    setVrcxCssLayers: vi.fn()
}));

vi.mock('@/platform/tauri/assets', () => ({
    convertFileSrc: mocks.convertFileSrc
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appRefreshTrayMenu: mocks.appRefreshTrayMenu,
        appCommunityThemeDebugLoadLocalTheme:
            mocks.appCommunityThemeDebugLoadLocalTheme
    }
}));

vi.mock('@/repositories/communityThemeRepository', () => ({
    COMMUNITY_THEME_CATALOG_URL: CATALOG_URL,
    COMMUNITY_THEME_CSS_FILE_NAME: CSS_FILE_NAME,
    loadCommunityThemeCatalog: mocks.loadCommunityThemeCatalog,
    loadCommunityThemeCss: mocks.loadCommunityThemeCss,
    resolveCommunityThemeAssetUrl: mocks.resolveCommunityThemeAssetUrl
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: mocks.getBool,
        getString: mocks.getString,
        getObject: mocks.getObject,
        getRawValue: mocks.getRawValue,
        setBool: mocks.setBool,
        setString: mocks.setString,
        setMany: mocks.setMany,
        remove: mocks.remove
    }
}));

vi.mock('@/shared/buildLabel', () => ({
    isDevToolsBuild: mocks.isDevToolsBuild
}));

vi.mock('./appearanceConflictCoordinator', () => ({
    disableBackgroundImageForCommunityTheme: mocks.disableBackgroundImage,
    isBackgroundImageAppearanceActive: mocks.isBackgroundImageActive,
    migrateLegacyNasaApodCommunityThemeForBackgroundImage:
        mocks.migrateLegacyNasaApodCommunityTheme,
    registerCommunityThemeAppearanceHandlers: vi.fn()
}));

vi.mock('./themeService', () => ({
    applyThemeColor: mocks.applyThemeColor,
    resolveThemeMode: mocks.resolveThemeMode,
    clearThemeColorInlineProperties: mocks.clearThemeColorInlineProperties,
    resolveThemeColor: mocks.resolveThemeColor,
    setCommunityThemeAppearanceControl: mocks.setCommunityThemeAppearanceControl
}));

vi.mock('./vrcxCssLayerService', () => ({
    setVrcxCssLayers: mocks.setVrcxCssLayers
}));

function themeRecord(
    themeId: string,
    cssSnapshot: string,
    patch: Record<string, unknown> = {}
) {
    return {
        themeId,
        themeName: `${themeId} name`,
        version: '1.0.0',
        sourceUrl: `${CATALOG_URL}/${themeId}/${CSS_FILE_NAME}`,
        sha256: `${themeId}-sha`,
        installedAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
        darkMode: true,
        accentMode: true,
        cssSnapshot,
        ...patch
    };
}

function manifest(id = 'theme-a', patch: Record<string, unknown> = {}) {
    return {
        id,
        name: `${id} name`,
        version: '1.0.0',
        tags: [],
        author: 'Tester',
        description: '',
        ...patch
    } as any;
}

function installBrowserStubs() {
    const attributes = new Map<string, string>();
    globalThis.document = {
        documentElement: {
            setAttribute: vi.fn((key: string, value: string) => {
                attributes.set(key, value);
            }),
            getAttribute: vi.fn((key: string) => attributes.get(key) ?? null),
            hasAttribute: vi.fn((key: string) => attributes.has(key)),
            removeAttribute: vi.fn((key: string) => {
                attributes.delete(key);
            }),
            style: {
                setProperty: vi.fn(),
                removeProperty: vi.fn()
            }
        }
    } as any;
    globalThis.window = {
        setInterval: vi.fn((handler: TimerHandler, timeout?: number) =>
            globalThis.setInterval(handler, timeout)
        ),
        clearInterval: vi.fn((timer: ReturnType<typeof setInterval>) => {
            globalThis.clearInterval(timer);
        })
    } as any;
}

async function loadCommunityThemeService() {
    vi.resetModules();
    const [service, store] = await Promise.all([
        import('./communityThemeService'),
        import('@/state/communityThemeStore')
    ]);
    return {
        service,
        useCommunityThemeStore: store.useCommunityThemeStore
    };
}

describe('communityThemeService characterization', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-02T03:04:05.000Z'));
        vi.clearAllMocks();
        installBrowserStubs();

        mocks.convertFileSrc.mockImplementation(
            (path: string) => `file:///converted/${path.replace(/\\/g, '/')}`
        );
        mocks.appRefreshTrayMenu.mockResolvedValue(undefined);
        mocks.appCommunityThemeDebugLoadLocalTheme.mockResolvedValue({
            folderPath: 'C:\\themes\\local',
            cssPath: 'C:\\themes\\local\\theme.css',
            manifestPath: 'C:\\themes\\local\\theme.json',
            themeName: 'Local Theme',
            version: '0.1.0',
            darkMode: false,
            accentMode: false,
            css: '.hero{background:url("./images/bg.png")}'
        });
        mocks.loadCommunityThemeCatalog.mockResolvedValue({
            sourceUrl: CATALOG_URL,
            themes: []
        });
        mocks.loadCommunityThemeCss.mockResolvedValue('.installed{}');
        mocks.resolveCommunityThemeAssetUrl.mockImplementation(
            (catalogUrl: string, themeId: string, fileName: string) =>
                `${catalogUrl}/${themeId}/${fileName}`
        );
        mocks.getBool.mockResolvedValue(false);
        mocks.getString.mockImplementation((key: string, fallback = '') =>
            Promise.resolve(String(fallback ?? ''))
        );
        mocks.getObject.mockResolvedValue(null);
        mocks.getRawValue.mockResolvedValue(null);
        mocks.setBool.mockResolvedValue(undefined);
        mocks.setString.mockResolvedValue(undefined);
        mocks.setMany.mockResolvedValue(undefined);
        mocks.remove.mockResolvedValue(undefined);
        mocks.isDevToolsBuild.mockReturnValue(true);
        mocks.disableBackgroundImage.mockResolvedValue(undefined);
        mocks.isBackgroundImageActive.mockReturnValue(false);
        mocks.migrateLegacyNasaApodCommunityTheme.mockResolvedValue(undefined);
        mocks.resolveThemeMode.mockImplementation((value: unknown) =>
            value === 'light' || value === 'dark' ? value : 'system'
        );
        mocks.resolveThemeColor.mockImplementation((value: unknown) =>
            String(value || 'default')
        );
        mocks.setCommunityThemeAppearanceControl.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        delete (globalThis as any).document;
        delete (globalThis as any).window;
    });

    it('loads the community theme catalog and records catalog failures', async () => {
        const catalogTheme = manifest('theme-c');
        mocks.loadCommunityThemeCatalog.mockResolvedValueOnce({
            sourceUrl: CATALOG_URL,
            themes: [catalogTheme]
        });
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();

        await expect(service.loadCatalog()).resolves.toEqual({
            sourceUrl: CATALOG_URL,
            themes: [catalogTheme]
        });

        expect(useCommunityThemeStore.getState()).toMatchObject({
            catalogUrl: CATALOG_URL,
            catalog: [catalogTheme],
            loading: false,
            error: null
        });

        const failure = new Error('catalog unavailable');
        mocks.loadCommunityThemeCatalog.mockRejectedValueOnce(failure);

        await expect(service.loadCatalog()).rejects.toBe(failure);
        expect(useCommunityThemeStore.getState()).toMatchObject({
            loading: false,
            error: 'catalog unavailable'
        });
    });

    it('initializes installed themes from current catalog records only', async () => {
        const validRecord = themeRecord('theme-a', '.theme-a{}', {
            accentMode: false
        });
        const staleRecord = themeRecord('theme-stale', '.stale{}', {
            sourceUrl: 'https://old.example.test/theme.css'
        });
        const legacyApodRecord = themeRecord('nasa-apod-wallpaper', '.apod{}');
        mocks.getBool.mockImplementation((key: string) =>
            Promise.resolve(key === 'VRCX_communityThemeEnabled')
        );
        mocks.getString.mockImplementation((key: string, fallback = '') => {
            const values: Record<string, string> = {
                VRCX_communityThemeId: 'theme-a',
                VRCX_communityThemeCssSnapshot: '',
                VRCX_communityThemeOverrideCss: '.override{}',
                VRCX_themeColor: 'blue',
                ThemeMode: 'dark'
            };
            return Promise.resolve(values[key] ?? String(fallback ?? ''));
        });
        mocks.getObject.mockImplementation((key: string) => {
            if (key === 'VRCX_communityThemeInstalledThemes') {
                return Promise.resolve([
                    staleRecord,
                    validRecord,
                    legacyApodRecord
                ]);
            }
            return Promise.resolve(null);
        });

        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();
        await service.initializeCommunityThemes();

        expect(useCommunityThemeStore.getState()).toMatchObject({
            enabled: true,
            installedTheme: expect.objectContaining({
                themeId: 'theme-a',
                themeName: 'theme-a name'
            }),
            installedThemes: [
                expect.objectContaining({
                    themeId: 'theme-a'
                })
            ],
            overrideCssLength: '.override{}'.length
        });
        expect(mocks.setMany).toHaveBeenCalledWith(
            expect.arrayContaining([
                ['VRCX_communityThemeEnabled', 'true'],
                ['VRCX_communityThemeId', 'theme-a'],
                ['VRCX_communityThemeCssSnapshot', '.theme-a{}']
            ])
        );
        expect(mocks.setVrcxCssLayers).toHaveBeenLastCalledWith({
            'installed-theme': '.theme-a{}',
            'local-theme-preview': '',
            'user-override': '.override{}'
        });
        expect(mocks.setCommunityThemeAppearanceControl).toHaveBeenCalledWith(
            true,
            undefined,
            'dark'
        );
        expect(document.documentElement.setAttribute).toHaveBeenCalledWith(
            'data-vrcx-0-community-theme-accent',
            'theme'
        );
        expect(mocks.appRefreshTrayMenu).toHaveBeenCalledTimes(1);
    });

    it('clears stored install state when only stale records remain', async () => {
        const staleRecord = themeRecord('theme-stale', '.stale{}', {
            sourceUrl: 'https://old.example.test/theme.css'
        });
        mocks.getBool.mockImplementation((key: string) =>
            Promise.resolve(key === 'VRCX_communityThemeEnabled')
        );
        mocks.getObject.mockImplementation((key: string) =>
            Promise.resolve(
                key === 'VRCX_communityThemeInstalledThemes'
                    ? [staleRecord]
                    : null
            )
        );

        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();
        await service.initializeCommunityThemes();

        expect(mocks.setBool).toHaveBeenCalledWith(
            'VRCX_communityThemeEnabled',
            false
        );
        expect(mocks.remove).toHaveBeenCalledWith('VRCX_communityThemeId');
        expect(mocks.remove).toHaveBeenCalledWith(
            'VRCX_communityThemeInstalledThemes'
        );
        expect(useCommunityThemeStore.getState()).toMatchObject({
            enabled: false,
            installedTheme: null,
            installedThemes: []
        });
    });

    it('installs and enables community themes with persisted CSS snapshots', async () => {
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();
        mocks.getObject.mockResolvedValue([]);
        mocks.loadCommunityThemeCss.mockResolvedValue('.theme-b{}');

        const metadata = await service.installCommunityTheme(
            manifest('theme-b', {
                darkMode: false,
                accentMode: true
            })
        );

        expect(metadata).toMatchObject({
            themeId: 'theme-b',
            themeName: 'theme-b name',
            version: '1.0.0',
            sourceUrl: `${CATALOG_URL}/theme-b/${CSS_FILE_NAME}`,
            installedAt: '2026-05-02T03:04:05.000Z',
            updatedAt: '2026-05-02T03:04:05.000Z',
            darkMode: false,
            accentMode: true
        });
        expect(mocks.disableBackgroundImage).toHaveBeenCalledWith({
            restoreAppTheme: false
        });
        expect(mocks.setMany).toHaveBeenCalledWith(
            expect.arrayContaining([
                ['VRCX_communityThemeEnabled', 'true'],
                ['VRCX_communityThemeId', 'theme-b'],
                ['VRCX_communityThemeCssSnapshot', '.theme-b{}']
            ])
        );
        expect(useCommunityThemeStore.getState().installedTheme).toMatchObject({
            themeId: 'theme-b'
        });

        mocks.getObject.mockResolvedValue([
            themeRecord('theme-a', '.theme-a{}'),
            themeRecord('theme-b', '.theme-b{}')
        ]);
        await service.enableInstalledCommunityTheme('theme-a');

        expect(useCommunityThemeStore.getState().installedTheme).toMatchObject({
            themeId: 'theme-a'
        });
        expect(mocks.setVrcxCssLayers).toHaveBeenLastCalledWith(
            expect.objectContaining({
                'installed-theme': '.theme-a{}'
            })
        );
    });

    it('disables and deletes installed theme records without losing remaining records', async () => {
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();
        const themeA = themeRecord('theme-a', '.theme-a{}');
        const themeB = themeRecord('theme-b', '.theme-b{}');
        mocks.getObject.mockResolvedValue([themeA, themeB]);
        useCommunityThemeStore.getState().hydrate({
            catalogUrl: CATALOG_URL,
            enabled: true,
            installedTheme: themeB,
            installedThemes: [themeA, themeB],
            overrideCssLength: 0,
            localPreview: null
        });

        await service.disableInstalledCommunityTheme();

        expect(useCommunityThemeStore.getState()).toMatchObject({
            enabled: false,
            installedTheme: null,
            installedThemes: [
                expect.objectContaining({ themeId: 'theme-a' }),
                expect.objectContaining({ themeId: 'theme-b' })
            ]
        });
        expect(mocks.setBool).toHaveBeenCalledWith(
            'VRCX_communityThemeEnabled',
            false
        );
        expect(mocks.setVrcxCssLayers).toHaveBeenLastCalledWith(
            expect.objectContaining({
                'installed-theme': ''
            })
        );

        useCommunityThemeStore.getState().hydrate({
            catalogUrl: CATALOG_URL,
            enabled: true,
            installedTheme: themeB,
            installedThemes: [themeA, themeB],
            overrideCssLength: 0,
            localPreview: null
        });
        await service.deleteInstalledCommunityTheme('theme-b');

        expect(useCommunityThemeStore.getState()).toMatchObject({
            enabled: false,
            installedTheme: null,
            installedThemes: [expect.objectContaining({ themeId: 'theme-a' })]
        });
    });

    it('persists override CSS and toggles its layer independently', async () => {
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();

        await service.saveCommunityThemeOverrideCss('.override{}');

        expect(mocks.setString).toHaveBeenCalledWith(
            'VRCX_communityThemeOverrideCss',
            '.override{}'
        );
        expect(mocks.setBool).toHaveBeenCalledWith(
            'VRCX_communityThemeOverrideEnabled',
            true
        );
        expect(service.getCommunityThemeOverrideCssSnapshot()).toBe(
            '.override{}'
        );
        expect(useCommunityThemeStore.getState().overrideCssLength).toBe(
            '.override{}'.length
        );
        expect(mocks.setVrcxCssLayers).toHaveBeenLastCalledWith(
            expect.objectContaining({
                'user-override': '.override{}'
            })
        );

        await service.disableCommunityThemeOverrideCss();

        expect(mocks.setBool).toHaveBeenCalledWith(
            'VRCX_communityThemeOverrideEnabled',
            false
        );
        expect(useCommunityThemeStore.getState().overrideCssLength).toBe(0);
        expect(mocks.setVrcxCssLayers).toHaveBeenLastCalledWith(
            expect.objectContaining({
                'user-override': ''
            })
        );
    });

    it('clears override CSS through the same persistence and layer path', async () => {
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();

        await service.saveCommunityThemeOverrideCss('.override{}');
        await service.clearCommunityThemeOverrideCss();

        expect(mocks.setString).toHaveBeenLastCalledWith(
            'VRCX_communityThemeOverrideCss',
            ''
        );
        expect(mocks.setBool).toHaveBeenLastCalledWith(
            'VRCX_communityThemeOverrideEnabled',
            false
        );
        expect(service.getCommunityThemeOverrideCssSnapshot()).toBe('');
        expect(useCommunityThemeStore.getState().overrideCssLength).toBe(0);
        expect(mocks.setVrcxCssLayers).toHaveBeenLastCalledWith(
            expect.objectContaining({
                'user-override': ''
            })
        );
    });

    it('loads local previews, rewrites relative asset URLs, and clears the watch timer', async () => {
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();
        mocks.appCommunityThemeDebugLoadLocalTheme.mockResolvedValue({
            folderPath: 'C:\\themes\\local',
            cssPath: 'C:\\themes\\local\\theme.css',
            manifestPath: 'C:\\themes\\local\\theme.json',
            themeName: 'Local Theme',
            version: '0.1.0',
            darkMode: false,
            accentMode: false,
            css: [
                '.hero{background:url("./images/bg.png")}',
                '.remote{background:url("https://cdn.example.test/a.png")}',
                '.hash{background:url(#mask)}'
            ].join('\n')
        });

        const preview =
            await service.loadLocalCommunityThemePreview('C:\\themes\\local');

        expect(preview).toMatchObject({
            folderPath: 'C:\\themes\\local',
            themeName: 'Local Theme',
            darkMode: false,
            accentMode: false,
            loadedAt: '2026-05-02T03:04:05.000Z'
        });
        const previewLayer =
            mocks.setVrcxCssLayers.mock.calls.at(-1)?.[0][
                'local-theme-preview'
            ];
        expect(previewLayer).toContain(
            'file:///converted/C:/themes/local/images/bg.png?vrcx0ThemePreview=2026-05-02T03%3A04%3A05.000Z'
        );
        expect(previewLayer).toContain('https://cdn.example.test/a.png');
        expect(previewLayer).toContain('url(#mask)');

        service.startLocalCommunityThemePreviewWatch(' C:\\themes\\local ');

        expect(
            useCommunityThemeStore.getState().localPreviewWatch
        ).toMatchObject({
            enabled: true,
            folderPath: 'C:\\themes\\local',
            error: null
        });
        expect(window.setInterval).toHaveBeenCalledWith(
            expect.any(Function),
            1200
        );

        service.stopLocalCommunityThemePreviewWatch();

        expect(window.clearInterval).toHaveBeenCalledTimes(1);
        expect(
            useCommunityThemeStore.getState().localPreviewWatch
        ).toMatchObject({
            enabled: false,
            error: null
        });
    });

    it('blocks local preview outside dev tools builds', async () => {
        mocks.isDevToolsBuild.mockReturnValue(false);
        const { service } = await loadCommunityThemeService();

        await expect(
            service.loadLocalCommunityThemePreview('C:\\themes\\local')
        ).rejects.toThrow(
            'Local theme preview is only available in dev or Theme Dev Kit builds.'
        );
        expect(
            mocks.appCommunityThemeDebugLoadLocalTheme
        ).not.toHaveBeenCalled();
    });

    it('records local preview watch reload errors in the store', async () => {
        mocks.appCommunityThemeDebugLoadLocalTheme.mockRejectedValueOnce(
            new Error('manifest missing')
        );
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();

        service.startLocalCommunityThemePreviewWatch('C:\\themes\\broken');
        await Promise.resolve();
        await Promise.resolve();

        expect(
            useCommunityThemeStore.getState().localPreviewWatch
        ).toMatchObject({
            enabled: true,
            folderPath: 'C:\\themes\\broken',
            error: 'manifest missing'
        });

        service.stopLocalCommunityThemePreviewWatch();
    });
});
