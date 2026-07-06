import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setTrayIconNotification: vi.fn(),
    bootstrapActivityCache: vi.fn(),
    startRuntimeAuthFailureRecovery: vi.fn(),
    bootstrapFavorites: vi.fn(),
    bootstrapFriendRoster: vi.fn(),
    startRuntimeGameClientSync: vi.fn(),
    stopGameStateService: vi.fn(),
    getTimeUnitLabels: vi.fn(),
    setI18nLanguage: vi.fn(),
    startRealtimeTransport: vi.fn(),
    stopRealtimeTransport: vi.fn(),
    bindRuntimeEvents: vi.fn(),
    initializeReactRuntime: vi.fn(),
    syncStartupServicesTask: vi.fn(),
    applyThemeMode: vi.fn(),
    startRuntimeUpdateLoop: vi.fn(),
    startVrcStatusPolling: vi.fn()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    setTrayIconNotification: mocks.setTrayIconNotification
}));

vi.mock('./activityCacheService', () => ({
    bootstrapActivityCache: mocks.bootstrapActivityCache
}));

vi.mock('./authSessionRecoveryService', () => ({
    startRuntimeAuthFailureRecovery: mocks.startRuntimeAuthFailureRecovery
}));

vi.mock('./favoriteBootstrapService', () => ({
    bootstrapFavorites: mocks.bootstrapFavorites
}));

vi.mock('./friendBootstrapService', () => ({
    bootstrapFriendRoster: mocks.bootstrapFriendRoster
}));

vi.mock('./gameClientLifecycle', () => ({
    startRuntimeGameClientSync: mocks.startRuntimeGameClientSync
}));

vi.mock('./gameStateService', () => ({
    stopGameStateService: mocks.stopGameStateService
}));

vi.mock('./i18nService', () => ({
    getTimeUnitLabels: mocks.getTimeUnitLabels,
    setI18nLanguage: mocks.setI18nLanguage
}));

vi.mock('./realtimeTransportService', () => ({
    startRealtimeTransport: mocks.startRealtimeTransport,
    stopRealtimeTransport: mocks.stopRealtimeTransport
}));

vi.mock('./runtimeEventBridgeService', () => ({
    bindRuntimeEvents: mocks.bindRuntimeEvents
}));

vi.mock('./startupService', () => ({
    initializeReactRuntime: mocks.initializeReactRuntime
}));

vi.mock('./startupServicesStatus', () => ({
    syncStartupServicesTask: mocks.syncStartupServicesTask
}));

vi.mock('./themeService', () => ({
    applyThemeMode: mocks.applyThemeMode
}));

vi.mock('./updateLoopService', () => ({
    startRuntimeUpdateLoop: mocks.startRuntimeUpdateLoop
}));

vi.mock('./vrcStatusService', () => ({
    startVrcStatusPolling: mocks.startVrcStatusPolling
}));

import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { DEFAULT_TIME_UNIT_LABELS, useShellStore } from '@/state/shellStore';

import {
    startAuthenticatedRuntimeServices,
    startI18nLanguageSync
} from './runtimeBootstrapService';

function installDocumentStub() {
    globalThis.document = {
        documentElement: {
            setAttribute: vi.fn()
        }
    } as unknown as Document;
}

function installWindowStub() {
    globalThis.window = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout
    } as unknown as Window & typeof globalThis;
}

function resetShellStore() {
    useShellStore.setState({
        locale: 'en',
        timeUnitLabels: DEFAULT_TIME_UNIT_LABELS
    });
}

describe('runtimeBootstrapService', () => {
    beforeEach(() => {
        installDocumentStub();
        installWindowStub();
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useNotificationStore.getState().resetNotificationState();
        resetShellStore();
        mocks.getTimeUnitLabels.mockImplementation(
            (locale: string, fallback: typeof DEFAULT_TIME_UNIT_LABELS) => ({
                ...fallback,
                h: `${locale}:h`
            })
        );
        mocks.setI18nLanguage.mockResolvedValue(undefined);
        mocks.bootstrapFriendRoster.mockResolvedValue(undefined);
        mocks.bootstrapFavorites.mockResolvedValue(undefined);
        mocks.bootstrapActivityCache.mockResolvedValue({
            userId: 'usr_self',
            stale: false
        });
        mocks.startRealtimeTransport.mockResolvedValue(undefined);
    });

    it('normalizes locale changes into document lang, time labels, and i18n service state', () => {
        useShellStore.getState().setLocale('zh_Hant_TW');

        const cleanup = startI18nLanguageSync();

        expect(document.documentElement.setAttribute).toHaveBeenCalledWith(
            'lang',
            'zh-TW'
        );
        expect(mocks.setI18nLanguage).toHaveBeenCalledWith('zh-TW');
        expect(useShellStore.getState().timeUnitLabels.h).toBe('zh-TW:h');

        useShellStore.getState().setLocale('en-US');

        expect(document.documentElement.setAttribute).toHaveBeenLastCalledWith(
            'lang',
            'en'
        );
        expect(mocks.setI18nLanguage).toHaveBeenLastCalledWith('en');
        expect(useShellStore.getState().timeUnitLabels.h).toBe('en:h');

        cleanup();
        useShellStore.getState().setLocale('zh_CN');
        expect(mocks.setI18nLanguage).toHaveBeenCalledTimes(2);
    });

    it('starts authenticated bootstraps before realtime and opens realtime only after friends are loaded', () => {
        const currentUserSnapshot = {
            id: 'usr_self',
            displayName: 'Current User'
        };
        useSessionStore.getState().setSessionState({
            sessionPhase: 'ready',
            isLoggedIn: true,
            isFriendsLoaded: false,
            isFavoritesLoaded: false
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example',
            currentUserWebsocket: 'wss://ws.example',
            currentUserSnapshot
        });

        const cleanup = startAuthenticatedRuntimeServices();

        expect(mocks.bootstrapFriendRoster).toHaveBeenCalledWith({
            userId: 'usr_self',
            endpoint: 'https://api.example',
            currentUserSnapshot
        });
        expect(mocks.bootstrapFavorites).toHaveBeenCalledWith({
            userId: 'usr_self',
            endpoint: 'https://api.example',
            currentUserSnapshot
        });
        expect(mocks.bootstrapActivityCache).toHaveBeenCalledWith({
            userId: 'usr_self',
            currentUserSnapshot
        });
        expect(mocks.startRealtimeTransport).not.toHaveBeenCalled();

        useSessionStore.getState().setFriendsLoaded(true);

        expect(mocks.startRealtimeTransport).toHaveBeenCalledWith({
            userId: 'usr_self',
            endpoint: 'https://api.example',
            websocket: 'wss://ws.example',
            currentUserSnapshot
        });

        cleanup();
        expect(mocks.stopRealtimeTransport.mock.calls.at(-1)).toEqual([]);
    });
});
