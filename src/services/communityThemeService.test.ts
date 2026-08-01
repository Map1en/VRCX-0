import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    CommunityThemeConfigureInput,
    CommunityThemeInstallMetadata,
    CommunityThemeProjection
} from '@/platform/tauri/bindings';

const CATALOG_URL = 'https://themes.example.test/index.json';

const mocks = vi.hoisted(() => ({
    convertFileSrc: vi.fn(),
    appRefreshTrayMenu: vi.fn(),
    appCommunityThemeDebugLoadLocalTheme: vi.fn(),
    appCommunityThemeStateGet: vi.fn(),
    appCommunityThemeCatalogGet: vi.fn(),
    appCommunityThemeStatsGet: vi.fn(),
    appCommunityThemeInstallReport: vi.fn(),
    appCommunityThemeConfigure: vi.fn(),
    getString: vi.fn(),
    isDevToolsBuild: vi.fn(),
    disableBackgroundImage: vi.fn(),
    isBackgroundImageActive: vi.fn(),
    registerCommunityThemeAppearanceHandlers: vi.fn(),
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
            mocks.appCommunityThemeDebugLoadLocalTheme,
        appCommunityThemeStateGet: mocks.appCommunityThemeStateGet,
        appCommunityThemeCatalogGet: mocks.appCommunityThemeCatalogGet,
        appCommunityThemeStatsGet: mocks.appCommunityThemeStatsGet,
        appCommunityThemeInstallReport: mocks.appCommunityThemeInstallReport,
        appCommunityThemeConfigure: mocks.appCommunityThemeConfigure
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: mocks.getString
    }
}));

vi.mock('@/shared/buildLabel', () => ({
    isDevToolsBuild: mocks.isDevToolsBuild
}));

vi.mock('./appearanceConflictCoordinator', () => ({
    disableBackgroundImageForCommunityTheme: mocks.disableBackgroundImage,
    isBackgroundImageAppearanceActive: mocks.isBackgroundImageActive,
    registerCommunityThemeAppearanceHandlers:
        mocks.registerCommunityThemeAppearanceHandlers
}));

vi.mock('./themeService', () => ({
    applyThemeColor: mocks.applyThemeColor,
    resolveThemeMode: mocks.resolveThemeMode,
    clearThemeColorInlineProperties: mocks.clearThemeColorInlineProperties,
    resolveThemeColor: mocks.resolveThemeColor,
    setCommunityThemeAppearanceControl: mocks.setCommunityThemeAppearanceControl
}));

vi.mock('./vrcx0CssLayerService', () => ({
    setVrcxCssLayers: mocks.setVrcxCssLayers
}));

function installedTheme(
    themeId = 'theme-a',
    patch: Partial<CommunityThemeInstallMetadata> = {}
): CommunityThemeInstallMetadata {
    return {
        themeId,
        themeName: `${themeId} name`,
        version: '1.0.0',
        sourceUrl: `${CATALOG_URL}/${themeId}/theme.css`,
        sha256: `${themeId}-sha`,
        installedAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
        darkMode: true,
        accentMode: false,
        ...patch
    };
}

function projection(
    revision: number,
    patch: Partial<CommunityThemeProjection> = {}
): CommunityThemeProjection {
    return {
        revision,
        catalogUrl: CATALOG_URL,
        enabled: false,
        installedTheme: null,
        installedThemes: [],
        installedCssSnapshot: '',
        overrideCss: '',
        overrideCssEnabled: false,
        ...patch
    };
}

function installBrowserStubs(): void {
    const attributes = new Map<string, string>();
    vi.stubGlobal('document', {
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
    });
    vi.stubGlobal('window', {
        setInterval: vi.fn((handler: TimerHandler, timeout?: number) =>
            globalThis.setInterval(handler, timeout)
        ),
        clearInterval: vi.fn((timer: ReturnType<typeof setInterval>) => {
            globalThis.clearInterval(timer);
        })
    });
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

describe('communityThemeService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-02T03:04:05.000Z'));
        vi.clearAllMocks();
        installBrowserStubs();

        mocks.convertFileSrc.mockImplementation(
            (path: string) => `file:///converted/${path.replace(/\\/g, '/')}`
        );
        mocks.appRefreshTrayMenu.mockResolvedValue(undefined);
        mocks.appCommunityThemeStateGet.mockResolvedValue(projection(1));
        mocks.appCommunityThemeCatalogGet.mockResolvedValue({
            sourceUrl: CATALOG_URL,
            schemaVersion: 1,
            themes: []
        });
        mocks.appCommunityThemeStatsGet.mockResolvedValue({});
        mocks.appCommunityThemeInstallReport.mockResolvedValue(true);
        mocks.appCommunityThemeConfigure.mockResolvedValue(projection(1));
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
        mocks.getString.mockImplementation((key: string, fallback = '') =>
            Promise.resolve(String(fallback))
        );
        mocks.isDevToolsBuild.mockReturnValue(true);
        mocks.disableBackgroundImage.mockResolvedValue(undefined);
        mocks.isBackgroundImageActive.mockReturnValue(false);
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
        vi.unstubAllGlobals();
    });

    it('keeps the public facade and registers projection refresh handlers', async () => {
        const { service } = await loadCommunityThemeService();

        expect(Object.keys(service).sort()).toEqual([
            'clearCommunityThemeOverrideCss',
            'deleteInstalledCommunityTheme',
            'disableCommunityThemeOverrideCss',
            'disableInstalledCommunityTheme',
            'enableInstalledCommunityTheme',
            'getCommunityThemeOverrideCssSnapshot',
            'initializeCommunityThemes',
            'installCommunityTheme',
            'isCommunityThemeAccentControlled',
            'loadCatalog',
            'loadCommunityThemeStats',
            'loadLocalCommunityThemePreview',
            'reportCommunityThemeInstall',
            'saveCommunityThemeOverrideCss',
            'startLocalCommunityThemePreviewWatch',
            'stopLocalCommunityThemePreview',
            'stopLocalCommunityThemePreviewWatch'
        ]);
        expect(
            mocks.registerCommunityThemeAppearanceHandlers
        ).toHaveBeenCalledWith({
            refreshInstalledCommunityTheme: expect.any(Function),
            stopLocalCommunityThemePreview:
                service.stopLocalCommunityThemePreview
        });
    });

    it('loads backend-owned catalog and stats endpoints', async () => {
        const catalog = {
            sourceUrl: CATALOG_URL,
            schemaVersion: 1,
            themes: []
        };
        mocks.appCommunityThemeCatalogGet.mockResolvedValueOnce(catalog);
        mocks.appCommunityThemeStatsGet.mockResolvedValueOnce({
            'theme-a': { downloads: 7 }
        });
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();

        await expect(service.loadCatalog()).resolves.toEqual(catalog);
        await expect(service.loadCommunityThemeStats()).resolves.toEqual({
            'theme-a': { downloads: 7 }
        });
        await expect(
            service.reportCommunityThemeInstall('theme-a')
        ).resolves.toBe(true);
        expect(mocks.appCommunityThemeInstallReport).toHaveBeenCalledWith(
            'theme-a'
        );
        expect(useCommunityThemeStore.getState()).toMatchObject({
            catalogUrl: CATALOG_URL,
            catalog: [],
            loading: false,
            error: null
        });
    });

    it('hydrates CSS and render mirrors from the Rust projection', async () => {
        const theme = installedTheme();
        mocks.appCommunityThemeStateGet.mockResolvedValueOnce(
            projection(4, {
                enabled: true,
                installedTheme: theme,
                installedThemes: [theme],
                installedCssSnapshot: '.theme{}',
                overrideCss: '.override{}',
                overrideCssEnabled: true
            })
        );
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();

        await service.initializeCommunityThemes();

        expect(useCommunityThemeStore.getState()).toMatchObject({
            enabled: true,
            installedTheme: theme,
            installedThemes: [theme],
            overrideCssLength: '.override{}'.length
        });
        expect(mocks.setVrcxCssLayers).toHaveBeenLastCalledWith({
            'installed-theme': '.theme{}',
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

    it('sends mutations to Rust and applies only returned projections', async () => {
        const theme = installedTheme('theme-b');
        let revision = 0;
        mocks.appCommunityThemeConfigure.mockImplementation(
            (input: CommunityThemeConfigureInput) => {
                revision += 1;
                if (input.kind === 'install') {
                    return Promise.resolve(
                        projection(revision, {
                            enabled: true,
                            installedTheme: theme,
                            installedThemes: [theme],
                            installedCssSnapshot: '.theme-b{}'
                        })
                    );
                }
                return Promise.resolve(
                    projection(revision, {
                        overrideCss:
                            input.kind === 'setOverride' ? input.cssText : '',
                        overrideCssEnabled:
                            input.kind === 'setOverride' &&
                            Boolean(input.cssText)
                    })
                );
            }
        );
        const { service, useCommunityThemeStore } =
            await loadCommunityThemeService();

        await expect(
            service.installCommunityTheme({
                id: 'theme-b',
                name: 'Untrusted frontend metadata',
                version: '0',
                author: { name: 'Tester', github: 'tester' },
                description: '',
                tags: [],
                testedWith: '',
                remoteAssets: false,
                darkMode: false,
                accentMode: true,
                previewUrl: '',
                readmeUrl: ''
            })
        ).resolves.toEqual(theme);
        expect(mocks.appCommunityThemeConfigure).toHaveBeenCalledWith({
            kind: 'install',
            themeId: 'theme-b'
        });
        expect(useCommunityThemeStore.getState().installedTheme).toEqual(theme);

        await service.saveCommunityThemeOverrideCss('.override{}');
        expect(mocks.appCommunityThemeConfigure).toHaveBeenLastCalledWith({
            kind: 'setOverride',
            cssText: '.override{}'
        });
        expect(service.getCommunityThemeOverrideCssSnapshot()).toBe(
            '.override{}'
        );

        await service.disableCommunityThemeOverrideCss();
        expect(mocks.appCommunityThemeConfigure).toHaveBeenLastCalledWith({
            kind: 'disableOverride'
        });
        expect(useCommunityThemeStore.getState().overrideCssLength).toBe(0);
    });

    it('loads local previews, rewrites relative URLs, and clears the watch timer', async () => {
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
});
