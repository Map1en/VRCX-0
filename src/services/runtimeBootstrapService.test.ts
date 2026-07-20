import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    startRuntimeGameClientSync: vi.fn(),
    stopGameStateService: vi.fn(),
    getTimeUnitLabels: vi.fn(),
    setI18nLanguage: vi.fn(),
    bindRuntimeEvents: vi.fn(),
    initializeReactRuntime: vi.fn(),
    applyThemeMode: vi.fn(),
    startRuntimeUpdateLoop: vi.fn(),
    startVrcStatusPolling: vi.fn()
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

vi.mock('./runtimeEventBridgeService', () => ({
    bindRuntimeEvents: mocks.bindRuntimeEvents
}));

vi.mock('./startupService', () => ({
    initializeReactRuntime: mocks.initializeReactRuntime
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

import { DEFAULT_TIME_UNIT_LABELS, useShellStore } from '@/state/shellStore';

import {
    startI18nLanguageSync,
    startReactRuntimeServices
} from './runtimeBootstrapService';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

function installDocumentStub(): void {
    globalThis.document = {
        documentElement: {
            setAttribute: vi.fn()
        }
    } as unknown as Document;
}

describe('runtimeBootstrapService', () => {
    beforeEach(() => {
        installDocumentStub();
        vi.clearAllMocks();
        useShellStore.setState({
            locale: 'en',
            timeUnitLabels: DEFAULT_TIME_UNIT_LABELS
        });
        mocks.getTimeUnitLabels.mockImplementation(
            (locale: string, fallback: typeof DEFAULT_TIME_UNIT_LABELS) => ({
                ...fallback,
                h: `${locale}:h`
            })
        );
        mocks.setI18nLanguage.mockResolvedValue(undefined);
        mocks.initializeReactRuntime.mockResolvedValue(undefined);
        mocks.bindRuntimeEvents.mockResolvedValue(undefined);
        mocks.startRuntimeGameClientSync.mockReturnValue(undefined);
        mocks.startRuntimeUpdateLoop.mockReturnValue(undefined);
        mocks.startVrcStatusPolling.mockReturnValue(undefined);
    });

    it('syncs normalized locale state', () => {
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

    it('shares React runtime startup across consumers', async () => {
        const initialization = deferred<void>();
        const eventCleanup = vi.fn();
        const gameClientCleanup = vi.fn();
        const updateLoopCleanup = vi.fn();
        const statusCleanup = vi.fn();
        mocks.initializeReactRuntime.mockReturnValue(initialization.promise);
        mocks.bindRuntimeEvents.mockResolvedValue(eventCleanup);
        mocks.startRuntimeGameClientSync.mockReturnValue(gameClientCleanup);
        mocks.startRuntimeUpdateLoop.mockReturnValue(updateLoopCleanup);
        mocks.startVrcStatusPolling.mockReturnValue(statusCleanup);

        const cleanupFirst = startReactRuntimeServices();
        const cleanupSecond = startReactRuntimeServices();
        expect(mocks.initializeReactRuntime).toHaveBeenCalledTimes(1);

        initialization.resolve();
        await vi.waitFor(() =>
            expect(mocks.bindRuntimeEvents).toHaveBeenCalled()
        );

        cleanupFirst();
        cleanupSecond();

        expect(eventCleanup).toHaveBeenCalledTimes(1);
        expect(gameClientCleanup).toHaveBeenCalledTimes(1);
        expect(updateLoopCleanup).toHaveBeenCalledTimes(1);
        expect(statusCleanup).toHaveBeenCalledTimes(1);
        expect(mocks.stopGameStateService).toHaveBeenCalledTimes(1);
    });

    it('cleans up runtime startup after its consumer leaves', async () => {
        const initialization = deferred<void>();
        const eventCleanup = vi.fn();
        mocks.initializeReactRuntime.mockReturnValue(initialization.promise);
        mocks.bindRuntimeEvents.mockResolvedValue(eventCleanup);

        const cleanup = startReactRuntimeServices();
        cleanup();
        initialization.resolve();

        await vi.waitFor(() => expect(eventCleanup).toHaveBeenCalledTimes(1));
        expect(mocks.stopGameStateService).toHaveBeenCalledTimes(1);
    });
});
