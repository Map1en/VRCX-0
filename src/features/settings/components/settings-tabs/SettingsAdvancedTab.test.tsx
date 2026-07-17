// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDataDirState } from '@/platform/tauri/bindings';
import { Tabs } from '@/ui/shadcn/tabs';
import { TooltipProvider } from '@/ui/shadcn/tooltip';

import { SettingsAdvancedTab } from './SettingsAdvancedTab';
import type { SettingsAdvancedModel } from './settingsAdvancedTypes';

const labels: Record<string, string> = {
    'view.settings.advanced.advanced_ui.behavior.deep_links':
        'Open VRCX-0 from links',
    'view.settings.advanced.advanced_ui.behavior.deep_link_registration':
        'Open VRCX-0 links',
    'view.settings.advanced.advanced_ui.storage.change_folder':
        'Change folder…',
    'view.settings.advanced.advanced_ui.storage.more':
        'More data location actions',
    'view.settings.advanced.advanced.data_directory.source_cli':
        'Command-line override',
    'view.settings.advanced.advanced.data_directory.source_default':
        'default directory',
    'view.settings.advanced.advanced.data_directory.source_persisted':
        'custom directory',
    'view.settings.advanced.advanced_ui.behavior.deep_link_repair': 'Fix'
};

const commandMocks = vi.hoisted(() => ({
    appDeepLinkRegistrationStatus: vi.fn(),
    appDeepLinkRegistrationRepair: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string) => labels[key] ?? key
    })
}));

vi.mock('./AdvancedTroubleshootingGroup', () => ({
    AdvancedTroubleshootingGroup: () => <div>troubleshooting</div>
}));

function appDataDirState(
    overrides: Partial<AppDataDirState> = {}
): AppDataDirState {
    return {
        cliDir: null,
        cliOverride: false,
        currentDir: 'C:\\VRCX-0',
        defaultDir: 'C:\\VRCX-0',
        persistedDir: null,
        source: 'default',
        ...overrides
    };
}

function createModel(
    overrides: Partial<SettingsAdvancedModel> = {}
): SettingsAdvancedModel {
    return {
        appDataDirState: appDataDirState(),
        avatarAutoCleanupOptions: ['Off'],
        configTreeData: {},
        onAnonymousUsageTelemetryChange: vi.fn(),
        onAutoSweepVRChatCacheChange: vi.fn(),
        onAvatarAutoCleanupChange: vi.fn(),
        onClearConfigTreeData: vi.fn(),
        onDefaultLaunchModeChange: vi.fn(),
        onGameLogDisabledChange: vi.fn(),
        onLogResourceLoadChange: vi.fn(),
        onMigrateLegacyVrcxData: vi.fn(),
        onOpenAppDataDirSelector: vi.fn(),
        onOpenPurgeDialog: vi.fn(),
        onRefreshConfigTreeData: vi.fn(),
        onRefreshOnlineVisits: vi.fn(),
        onRefreshSqliteTableSizes: vi.fn(),
        onRelaunchVRChatAfterCrashChange: vi.fn(),
        onResetAppDataDir: vi.fn(),
        onUdonExceptionLoggingChange: vi.fn(),
        onVrcQuitFixChange: vi.fn(),
        onlineVisitCount: null,
        prefs: {
            anonymousUsageTelemetry: false,
            autoSweepVRChatCache: false,
            avatarAutoCleanup: 'Off',
            defaultLaunchMode: 'vr',
            gameLogDisabled: false,
            logResourceLoad: false,
            relaunchVRChatAfterCrash: false,
            udonExceptionLogging: false,
            vrcQuitFix: true
        },
        sqliteTableSizeRows: [],
        sqliteTableSizes: {},
        ...overrides
    };
}

function renderTab(model: SettingsAdvancedModel) {
    return render(
        <TooltipProvider>
            <Tabs value="advanced">
                <SettingsAdvancedTab advanced={model} />
            </Tabs>
        </TooltipProvider>
    );
}

describe('SettingsAdvancedTab data directory states', () => {
    afterEach(cleanup);

    beforeEach(() => {
        commandMocks.appDeepLinkRegistrationStatus
            .mockReset()
            .mockResolvedValue(null);
        commandMocks.appDeepLinkRegistrationRepair
            .mockReset()
            .mockResolvedValue(true);
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            }
        );
    });

    it('shows the cross-platform Fix action without a separate heading', async () => {
        commandMocks.appDeepLinkRegistrationStatus.mockRejectedValueOnce(
            new Error('registry value is malformed')
        );

        renderTab(createModel());

        expect(
            await screen.findByRole('button', {
                name: 'Fix'
            })
        ).not.toBeNull();
        expect(screen.getByText('Open VRCX-0 links')).not.toBeNull();
        expect(screen.queryByText('Open VRCX-0 from links')).toBeNull();
    });

    it('keeps the repair action hidden on unsupported platforms', async () => {
        renderTab(createModel());

        await vi.waitFor(() => {
            expect(
                commandMocks.appDeepLinkRegistrationStatus
            ).toHaveBeenCalledOnce();
        });
        expect(
            screen.queryByRole('button', {
                name: 'Fix'
            })
        ).toBeNull();
    });

    it('shows only Change folder for the default directory', () => {
        renderTab(createModel());

        expect(
            (
                screen.getByRole('button', {
                    name: 'Change folder…'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
        expect(
            screen.queryByRole('button', {
                name: 'More data location actions'
            })
        ).toBeNull();
    });

    it('shows the More menu for a custom directory', () => {
        renderTab(
            createModel({
                appDataDirState: appDataDirState({
                    persistedDir: 'D:\\VRCX-0',
                    source: 'persisted'
                })
            })
        );

        expect(
            screen.getByRole('button', {
                name: 'More data location actions'
            })
        ).toBeTruthy();
    });

    it('disables directory actions for a CLI override', () => {
        renderTab(
            createModel({
                appDataDirState: appDataDirState({
                    cliDir: 'E:\\Portable',
                    cliOverride: true,
                    currentDir: 'E:\\Portable',
                    source: 'cli'
                })
            })
        );

        expect(
            (
                screen.getByRole('button', {
                    name: 'Change folder…'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
        expect(screen.getByText('Command-line override')).toBeTruthy();
        expect(
            screen.queryByRole('button', {
                name: 'More data location actions'
            })
        ).toBeNull();
    });
});
