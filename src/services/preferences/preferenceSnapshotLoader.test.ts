import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appSystemCulture: vi.fn(),
    getRawValue: vi.fn(),
    getBool: vi.fn(),
    getString: vi.fn(),
    getInt: vi.fn(),
    getArray: vi.fn(),
    getObject: vi.fn(),
    setBool: vi.fn(),
    setString: vi.fn(),
    storageGetString: vi.fn(),
    configureRecentActionCooldown: vi.fn(),
    applyTrustColorClasses: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSystemCulture: mocks.appSystemCulture
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getRawValue: mocks.getRawValue,
        getBool: mocks.getBool,
        getString: mocks.getString,
        getInt: mocks.getInt,
        getArray: mocks.getArray,
        getObject: mocks.getObject,
        setBool: mocks.setBool,
        setString: mocks.setString
    }
}));

vi.mock('@/repositories/storageRepository', () => ({
    default: {
        getString: mocks.storageGetString
    }
}));

vi.mock('../recentActionService', () => ({
    configureRecentActionCooldown: mocks.configureRecentActionCooldown
}));

vi.mock('../trustColorService', () => ({
    applyTrustColorClasses: mocks.applyTrustColorClasses
}));

import {
    DEFAULT_PREFERENCES,
    usePreferencesStore
} from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

import { loadPreferenceSnapshot } from './preferenceSnapshotLoader';

function installDocumentStub() {
    const classes = new Set<string>();
    globalThis.document = {
        documentElement: {
            setAttribute: vi.fn(),
            classList: {
                add: vi.fn((name: string) => classes.add(name)),
                remove: vi.fn((name: string) => classes.delete(name)),
                toggle: vi.fn((name: string, enabled?: boolean) => {
                    const nextEnabled =
                        enabled === undefined ? !classes.has(name) : enabled;
                    if (nextEnabled) {
                        classes.add(name);
                    } else {
                        classes.delete(name);
                    }
                    return nextEnabled;
                }),
                contains: vi.fn((name: string) => classes.has(name))
            },
            style: {
                setProperty: vi.fn(),
                removeProperty: vi.fn()
            }
        }
    } as unknown as Document;
    return classes;
}

describe('preferenceSnapshotLoader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        installDocumentStub();
        usePreferencesStore.getState().hydratePreferences(DEFAULT_PREFERENCES);
        useShellStore.setState({
            locale: 'en',
            tableDensity: 'standard',
            notificationLayout: 'notification-center',
            navWidth: 240,
            rightSidebarOpen: true
        } as Partial<ReturnType<typeof useShellStore.getState>>);

        mocks.getRawValue.mockResolvedValue(null);
        mocks.getBool.mockImplementation((_key: string, fallback = false) =>
            Promise.resolve(Boolean(fallback))
        );
        mocks.getString.mockImplementation((_key: string, fallback = '') =>
            Promise.resolve(String(fallback ?? ''))
        );
        mocks.getInt.mockImplementation((_key: string, fallback = 0) =>
            Promise.resolve(Number(fallback))
        );
        mocks.getArray.mockImplementation((_key: string, fallback: unknown[]) =>
            Promise.resolve(fallback)
        );
        mocks.getObject.mockImplementation((_key: string, fallback: unknown) =>
            Promise.resolve(fallback)
        );
        mocks.setBool.mockResolvedValue(undefined);
        mocks.setString.mockResolvedValue(undefined);
        mocks.storageGetString.mockImplementation(
            (_key: string, fallback = '') =>
                Promise.resolve(String(fallback ?? ''))
        );
        mocks.appSystemCulture.mockResolvedValue('ja-JP');
    });

    it('only reads the backend-seeded HMD notification preference', async () => {
        mocks.getBool.mockImplementation((key: string, fallback = false) =>
            Promise.resolve(
                key === 'hmdNotificationsEnabled' ? false : Boolean(fallback)
            )
        );

        const snapshot = await loadPreferenceSnapshot();

        expect(mocks.setBool).not.toHaveBeenCalledWith(
            'hmdNotificationsEnabled',
            expect.anything()
        );
        expect(snapshot.hmdNotificationsEnabled).toBe(false);
    });

    it('loads and normalizes shell, proxy, table, and notification preferences', async () => {
        const classes = installDocumentStub();
        mocks.getString.mockImplementation((key: string, fallback = '') => {
            const values: Record<string, string> = {
                tableDensity: '',
                notificationLayout: 'table',
                hmdNotificationStartMode: 'steamvr',
                hmdNotificationPosition: 'left',
                webhookFields: 'event,displayName',
                VRCX_fontFamily: 'invalid-font',
                VRCX_cjkFontPack: 'invalid-cjk',
                customFontFamily: 'Custom Font'
            };
            return Promise.resolve(values[key] ?? String(fallback ?? ''));
        });
        mocks.getInt.mockImplementation((key: string, fallback = 0) => {
            const values: Record<string, number> = {
                navPanelWidth: 9999,
                recentActionCooldownMinutes: 9999,
                hmdNotificationTimeout: 999999,
                hmdNotificationOpacity: -1,
                VRCX_tablePageSize: 25,
                maxTableSize_v2: 5,
                searchLimit: 999999
            };
            return Promise.resolve(values[key] ?? Number(fallback));
        });
        mocks.getBool.mockImplementation((key: string, fallback = false) =>
            Promise.resolve(
                key === 'compactTableMode' ||
                    key === 'dataTableStriped' ||
                    key === 'reducedMotionAndBlur'
                    ? true
                    : Boolean(fallback)
            )
        );
        mocks.getArray.mockImplementation((key: string, fallback: unknown[]) =>
            Promise.resolve(
                key === 'VRCX_tablePageSizes'
                    ? ['50', '10', 'bad', '25', '10']
                    : fallback
            )
        );
        mocks.storageGetString.mockImplementation(
            (key: string, fallback = '') => {
                if (key === 'VRCX_ProxyEnabled') {
                    return Promise.resolve('');
                }
                if (key === 'VRCX_ProxyServer') {
                    return Promise.resolve('127.0.0.1:7890');
                }
                return Promise.resolve(String(fallback ?? ''));
            }
        );

        const snapshot = await loadPreferenceSnapshot();

        expect(snapshot).toMatchObject({
            notificationLayout: 'table',
            tableDensity: 'compact',
            reducedMotionAndBlur: true,
            recentActionCooldownMinutes: 1440,
            hmdNotificationStartMode: 'steamvr',
            hmdNotificationTimeout: 30000,
            hmdNotificationOpacity: 0,
            hmdNotificationPosition: 'left',
            webhookFields: 'event,displayName',
            appFontFamily: 'geist',
            appCjkFontPack: 'noto',
            customFontFamily: 'Custom Font',
            proxyEnabled: true,
            proxyServer: '127.0.0.1:7890',
            tablePageSize: 25,
            tablePageSizes: [10, 25, 50],
            tableLimits: {
                maxTableSize: 100,
                searchLimit: 100000
            }
        });
        expect(usePreferencesStore.getState()).toMatchObject({
            preferencesHydrated: true,
            notificationLayout: 'table',
            tableDensity: 'compact',
            proxyEnabled: true
        });
        expect(useShellStore.getState()).toMatchObject({
            notificationLayout: 'table',
            tableDensity: 'compact',
            navWidth: 480,
            dateCulture: 'ja-JP'
        });
        expect(classes.has('is-compact-table')).toBe(true);
        expect(classes.has('is-striped-table')).toBe(true);
        expect(classes.has('reduce-effects')).toBe(true);
        expect(mocks.configureRecentActionCooldown).toHaveBeenCalledWith({
            enabled: false,
            minutes: 1440
        });
        expect(mocks.setString).toHaveBeenCalledWith(
            'VRCX_tableDensity',
            'compact'
        );
    });

    it('loads the user dialog profile decoration visibility preference', async () => {
        mocks.getBool.mockImplementation((key: string, fallback = false) =>
            Promise.resolve(
                key === 'showUserDialogProfileDecorations'
                    ? false
                    : Boolean(fallback)
            )
        );

        const snapshot = await loadPreferenceSnapshot();

        expect(mocks.getBool).toHaveBeenCalledWith(
            'showUserDialogProfileDecorations',
            true
        );
        expect(snapshot.showUserDialogProfileDecorations).toBe(false);
        expect(
            usePreferencesStore.getState().showUserDialogProfileDecorations
        ).toBe(false);
    });

    it('loads an explicit Friend Log notification dot opt-out', async () => {
        mocks.getBool.mockImplementation((key: string, fallback = false) =>
            Promise.resolve(
                key === 'friendLogNotificationDot' ? false : Boolean(fallback)
            )
        );

        const snapshot = await loadPreferenceSnapshot();

        expect(mocks.getBool).toHaveBeenCalledWith(
            'friendLogNotificationDot',
            true
        );
        expect(snapshot.friendLogNotificationDot).toBe(false);
        expect(usePreferencesStore.getState().friendLogNotificationDot).toBe(
            false
        );
    });
});
