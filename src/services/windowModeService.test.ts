// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WindowBounds, WindowGeometry } from '@/platform/tauri/webview';

const mocks = vi.hoisted(() => ({
    suspendSidebarAutoHide: vi.fn<(suspended: boolean) => Promise<void>>(),
    getWindowGeometry: vi.fn<() => Promise<WindowGeometry | null>>(),
    maximizeWindow: vi.fn<() => Promise<void>>(),
    unmaximizeWindow: vi.fn<() => Promise<void>>(),
    setWindowBounds: vi.fn<(bounds: WindowBounds) => Promise<void>>(),
    setWindowPhysicalPosition: vi.fn<(x: number, y: number) => Promise<void>>(),
    setWindowSizeConstraints:
        vi.fn<(constraints: Record<string, number>) => Promise<void>>(),
    setWindowMaximizable: vi.fn<(maximizable: boolean) => Promise<void>>(),
    setWindowAlwaysOnTop: vi.fn<(alwaysOnTop: boolean) => Promise<void>>()
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        webview: mocks
    }
}));

vi.mock('@/services/shellIntegrationService', () => ({
    setTaskbarOverlayNotification: vi.fn(),
    setTrayIconNotification: vi.fn()
}));

vi.mock('./sidebarAutoHideService', () => ({
    suspendSidebarAutoHide: mocks.suspendSidebarAutoHide
}));

import { useCriticalTaskStore } from '@/state/criticalTaskStore';
import { useDialogStore } from '@/state/dialogStore';
import { useShellStore } from '@/state/shellStore';

import {
    enterSidebarWindowMode,
    initializeWindowAlwaysOnTop,
    initializeWindowDisplayMode,
    leaveSidebarWindowModeForLogin,
    restoreNormalWindowMode,
    restoreSidebarWindowModeAfterLogin,
    setWindowAlwaysOnTop
} from './windowModeService';

const storedValues = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
        clear: () => storedValues.clear(),
        getItem: (key: string) => storedValues.get(key) ?? null,
        removeItem: (key: string) => storedValues.delete(key),
        setItem: (key: string, value: string) => {
            storedValues.set(key, value);
        }
    }
});

function createGeometry(
    overrides: Partial<WindowGeometry> = {}
): WindowGeometry {
    const workArea = {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
        scaleFactor: 1
    };
    return {
        innerSize: { width: 1200, height: 800 },
        outerSize: { width: 1216, height: 838 },
        outerPosition: { x: 100, y: 100 },
        scaleFactor: 1,
        maximized: false,
        currentWorkArea: workArea,
        workAreas: [workArea],
        ...overrides
    };
}

beforeEach(() => {
    window.localStorage.clear();
    useDialogStore.getState().clearDialogState();
    useShellStore.setState({
        windowDisplayMode: 'normal',
        windowAlwaysOnTop: false
    });
    useCriticalTaskStore.setState({ activeTasks: [] });
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.suspendSidebarAutoHide.mockResolvedValue(undefined);
    mocks.getWindowGeometry.mockResolvedValue(null);
    mocks.maximizeWindow.mockResolvedValue(undefined);
    mocks.unmaximizeWindow.mockResolvedValue(undefined);
    mocks.setWindowBounds.mockResolvedValue(undefined);
    mocks.setWindowPhysicalPosition.mockResolvedValue(undefined);
    mocks.setWindowSizeConstraints.mockResolvedValue(undefined);
    mocks.setWindowMaximizable.mockResolvedValue(undefined);
    mocks.setWindowAlwaysOnTop.mockResolvedValue(undefined);
});

describe('windowModeService', () => {
    it.each(['normal', 'sidebar'] as const)(
        'closes the main dialog and trail immediately when switching from %s without closing a later dialog',
        async (mode) => {
            useShellStore.setState({ windowDisplayMode: mode });
            useDialogStore
                .getState()
                .setDialogTrail(
                    { kind: 'world', entityId: 'wrld_old', title: 'Old world' },
                    [{ kind: 'user', entityId: 'usr_old', title: 'Old user' }]
                );
            mocks.getWindowGeometry.mockResolvedValue(createGeometry());

            const transition =
                mode === 'normal'
                    ? enterSidebarWindowMode()
                    : restoreNormalWindowMode();

            expect(useDialogStore.getState().activeDialog).toBeNull();
            expect(useDialogStore.getState().breadcrumbs).toEqual([]);
            const nextDialog = {
                kind: 'user',
                entityId: 'usr_new',
                title: 'New user'
            };
            useDialogStore.getState().openDialog(nextDialog);
            await transition;
            expect(useDialogStore.getState().activeDialog).toEqual(nextDialog);
        }
    );

    it.each(['normal', 'sidebar'] as const)(
        'keeps the main dialog when already in %s mode',
        async (mode) => {
            useShellStore.setState({ windowDisplayMode: mode });
            const dialog = {
                kind: 'user',
                entityId: 'usr_current',
                title: 'Current user'
            };
            useDialogStore.getState().openDialog(dialog);
            await (mode === 'normal'
                ? restoreNormalWindowMode()
                : enterSidebarWindowMode());
            expect(useDialogStore.getState().activeDialog).toEqual(dialog);
        }
    );

    it('reveals and suspends auto-hide before reading geometry, then resumes it', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        mocks.getWindowGeometry.mockResolvedValue(createGeometry());

        await restoreNormalWindowMode();

        expect(mocks.suspendSidebarAutoHide.mock.calls).toEqual([
            [true],
            [false]
        ]);
        expect(
            mocks.suspendSidebarAutoHide.mock.invocationCallOrder[0]
        ).toBeLessThan(mocks.getWindowGeometry.mock.invocationCallOrder[0]);
        expect(
            mocks.suspendSidebarAutoHide.mock.invocationCallOrder[1]
        ).toBeGreaterThan(mocks.setWindowBounds.mock.invocationCallOrder[0]);
    });

    it('keeps sidebar mode when revealing the edge-hidden window fails', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        mocks.suspendSidebarAutoHide.mockRejectedValueOnce(
            new Error('reveal failed')
        );

        await expect(restoreNormalWindowMode()).rejects.toThrow(
            'reveal failed'
        );

        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
        expect(mocks.getWindowGeometry).not.toHaveBeenCalled();
        expect(mocks.suspendSidebarAutoHide.mock.calls).toEqual([
            [true],
            [false]
        ]);
    });

    it('does not fail an already restored window when resuming auto-hide fails', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        mocks.getWindowGeometry.mockResolvedValue(createGeometry());
        mocks.suspendSidebarAutoHide
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('resume failed'));
        const warning = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        try {
            await expect(restoreNormalWindowMode()).resolves.toBeUndefined();
            expect(useShellStore.getState().windowDisplayMode).toBe('normal');
            expect(warning).toHaveBeenCalledWith(
                'Failed to resume sidebar auto-hide:',
                expect.any(Error)
            );
        } finally {
            warning.mockRestore();
        }
    });
    it('captures the normal bounds and right-anchors the initial sidebar width', async () => {
        mocks.getWindowGeometry
            .mockResolvedValueOnce(createGeometry())
            .mockResolvedValueOnce(
                createGeometry({
                    innerSize: { width: 480, height: 800 },
                    outerSize: { width: 496, height: 838 }
                })
            );

        await enterSidebarWindowMode(480);

        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
        expect(mocks.setWindowSizeConstraints).toHaveBeenCalledWith({
            minWidth: 320,
            minHeight: 240,
            maxWidth: 600
        });
        expect(mocks.setWindowBounds).toHaveBeenCalledWith({
            width: 480,
            height: 800,
            x: 820,
            y: 100
        });
        expect(mocks.setWindowBounds).toHaveBeenCalledTimes(1);
        expect(mocks.setWindowMaximizable).toHaveBeenCalledWith(false);
        expect(
            JSON.parse(
                window.localStorage.getItem('vrcx-main-window-normal-bounds') ??
                    '{}'
            )
        ).toMatchObject({
            width: 1200,
            x: 100,
            y: 100
        });
    });

    it('uses the internal default width on the first titlebar entry', async () => {
        mocks.getWindowGeometry
            .mockResolvedValueOnce(createGeometry())
            .mockResolvedValueOnce(
                createGeometry({
                    innerSize: { width: 360, height: 800 },
                    outerSize: { width: 376, height: 838 },
                    outerPosition: { x: 940, y: 100 }
                })
            );

        await enterSidebarWindowMode();

        expect(mocks.setWindowBounds).toHaveBeenCalledWith({
            width: 360,
            height: 800,
            x: 940,
            y: 100
        });
    });

    it('restores the normal width while preserving the sidebar height', async () => {
        window.localStorage.setItem(
            'vrcx-main-window-normal-bounds',
            JSON.stringify({
                version: 1,
                x: 80,
                y: 60,
                width: 1100
            })
        );
        useShellStore.getState().setWindowDisplayMode('sidebar');
        mocks.getWindowGeometry
            .mockResolvedValueOnce(
                createGeometry({
                    innerSize: { width: 520, height: 800 },
                    outerSize: { width: 536, height: 838 },
                    outerPosition: { x: 800, y: 150 }
                })
            )
            .mockResolvedValueOnce(
                createGeometry({
                    innerSize: { width: 1100, height: 800 },
                    outerSize: { width: 1116, height: 838 },
                    outerPosition: { x: 80, y: 150 }
                })
            );

        await restoreNormalWindowMode();

        expect(useShellStore.getState().windowDisplayMode).toBe('normal');
        expect(mocks.setWindowSizeConstraints).toHaveBeenCalledWith({
            minWidth: 320,
            minHeight: 240
        });
        expect(mocks.setWindowBounds).toHaveBeenCalledWith({
            width: 1100,
            height: 800,
            x: 80,
            y: 150
        });
        expect(mocks.setWindowBounds).toHaveBeenCalledTimes(1);
        expect(mocks.maximizeWindow).not.toHaveBeenCalled();
        expect(
            window.localStorage.getItem('vrcx-main-window-sidebar-width')
        ).toBe('520');
    });

    it('returns to sidebar mode when normal-window geometry is unavailable', async () => {
        useShellStore.getState().setWindowDisplayMode('sidebar');

        await expect(restoreNormalWindowMode()).rejects.toThrow(
            'Unable to read the current window geometry.'
        );

        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
        expect(mocks.setWindowSizeConstraints).toHaveBeenLastCalledWith({
            minWidth: 320,
            minHeight: 240,
            maxWidth: 600
        });
    });

    it('restores captured sidebar bounds when expansion fails', async () => {
        const compactGeometry = createGeometry({
            innerSize: { width: 520, height: 800 },
            outerSize: { width: 536, height: 838 },
            outerPosition: { x: 800, y: 150 }
        });
        useShellStore.getState().setWindowDisplayMode('sidebar');
        mocks.getWindowGeometry.mockResolvedValueOnce(compactGeometry);
        mocks.setWindowBounds.mockRejectedValueOnce(new Error('resize failed'));

        await expect(restoreNormalWindowMode()).rejects.toThrow(
            'resize failed'
        );

        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
        expect(mocks.setWindowBounds).toHaveBeenLastCalledWith({
            width: 520,
            height: 800,
            x: 800,
            y: 150
        });
        expect(mocks.setWindowSizeConstraints).toHaveBeenLastCalledWith({
            minWidth: 320,
            minHeight: 240,
            maxWidth: 600
        });
    });

    it('reuses a previously dragged sidebar width up to the 600px limit', async () => {
        window.localStorage.setItem('vrcx-main-window-sidebar-width', '1200');
        mocks.getWindowGeometry
            .mockResolvedValueOnce(createGeometry())
            .mockResolvedValueOnce(
                createGeometry({
                    innerSize: { width: 600, height: 800 },
                    outerSize: { width: 616, height: 838 }
                })
            );

        await enterSidebarWindowMode(360);

        expect(mocks.setWindowBounds).toHaveBeenCalledWith(
            expect.objectContaining({ width: 600, height: 800 })
        );
    });

    it('rolls back the restored normal window when entering sidebar mode fails', async () => {
        const normalGeometry = createGeometry();
        mocks.getWindowGeometry
            .mockResolvedValueOnce(
                createGeometry({
                    maximized: true,
                    innerSize: { width: 1920, height: 1040 },
                    outerSize: { width: 1920, height: 1040 },
                    outerPosition: { x: 0, y: 0 }
                })
            )
            .mockResolvedValueOnce(normalGeometry);
        mocks.setWindowBounds.mockRejectedValueOnce(new Error('resize failed'));

        await expect(enterSidebarWindowMode(480)).rejects.toThrow(
            'resize failed'
        );

        expect(useShellStore.getState().windowDisplayMode).toBe('normal');
        expect(mocks.unmaximizeWindow).toHaveBeenCalledOnce();
        expect(mocks.setWindowBounds).toHaveBeenLastCalledWith({
            width: 1200,
            height: 800,
            x: 100,
            y: 100
        });
        expect(mocks.maximizeWindow).toHaveBeenCalledOnce();
    });

    it('restores the sidebar constraints when the persisted mode starts', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });

        await initializeWindowDisplayMode();

        expect(mocks.setWindowMaximizable).toHaveBeenCalledWith(false);
        expect(mocks.setWindowSizeConstraints).toHaveBeenCalledWith({
            minWidth: 320,
            minHeight: 240,
            maxWidth: 600
        });
    });

    it('recovers an out-of-range startup window to the saved sidebar width', async () => {
        window.localStorage.setItem('vrcx-main-window-sidebar-width', '480');
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        mocks.getWindowGeometry.mockResolvedValueOnce(createGeometry());

        await initializeWindowDisplayMode();

        expect(mocks.setWindowBounds).toHaveBeenCalledWith({
            width: 480,
            height: 800,
            x: 820,
            y: 100
        });
    });
});

describe('remembered window display mode', () => {
    it('persists a user requested switch out of sidebar mode', async () => {
        useShellStore.getState().setWindowDisplayMode('sidebar');
        mocks.getWindowGeometry.mockResolvedValue(createGeometry());

        await restoreNormalWindowMode();

        expect(
            window.localStorage.getItem('vrcx-main-window-display-mode')
        ).toBe('normal');
    });

    it('keeps the remembered sidebar mode while the login screen needs the full window', async () => {
        useShellStore.getState().setWindowDisplayMode('sidebar');
        mocks.getWindowGeometry.mockResolvedValue(createGeometry());

        leaveSidebarWindowModeForLogin();
        await Promise.resolve();
        await Promise.resolve();

        expect(useShellStore.getState().windowDisplayMode).toBe('normal');
        expect(
            window.localStorage.getItem('vrcx-main-window-display-mode')
        ).toBe('sidebar');

        restoreSidebarWindowModeAfterLogin();
        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
    });

    it('does nothing after login when sidebar mode was never suspended', () => {
        useShellStore.getState().setWindowDisplayMode('normal');

        restoreSidebarWindowModeAfterLogin();

        expect(useShellStore.getState().windowDisplayMode).toBe('normal');
    });

    it('keeps the full window while a critical task is running', async () => {
        const dialog = {
            kind: 'user',
            entityId: 'usr_current',
            title: 'Current user'
        };
        useDialogStore.getState().openDialog(dialog);
        useCriticalTaskStore
            .getState()
            .setCriticalTaskActive('databaseUpgrade', true);

        await enterSidebarWindowMode();

        expect(useShellStore.getState().windowDisplayMode).toBe('normal');
        expect(mocks.getWindowGeometry).not.toHaveBeenCalled();
        expect(mocks.suspendSidebarAutoHide).not.toHaveBeenCalled();
        expect(useDialogStore.getState().activeDialog).toEqual(dialog);
    });

    it('defers the post-login sidebar restore until the critical task ends', async () => {
        useShellStore.getState().setWindowDisplayMode('sidebar');
        mocks.getWindowGeometry.mockResolvedValue(createGeometry());
        leaveSidebarWindowModeForLogin();
        await Promise.resolve();
        await Promise.resolve();
        useCriticalTaskStore
            .getState()
            .setCriticalTaskActive('databaseUpgrade', true);

        restoreSidebarWindowModeAfterLogin();
        expect(useShellStore.getState().windowDisplayMode).toBe('normal');

        useCriticalTaskStore
            .getState()
            .setCriticalTaskActive('databaseUpgrade', false);
        restoreSidebarWindowModeAfterLogin();

        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
    });

    it.each(['normal', 'sidebar'] as const)(
        'keeps the always-on-top window state through a %s mode transition',
        async (mode) => {
            useShellStore.setState({ windowDisplayMode: mode });
            mocks.getWindowGeometry.mockResolvedValue(createGeometry());
            await setWindowAlwaysOnTop(true);

            await (mode === 'normal'
                ? enterSidebarWindowMode()
                : restoreNormalWindowMode());

            expect(useShellStore.getState().windowAlwaysOnTop).toBe(true);
            expect(mocks.setWindowAlwaysOnTop).toHaveBeenCalledTimes(1);
            expect(mocks.setWindowAlwaysOnTop).toHaveBeenCalledWith(true);
        }
    );

    it('restores a remembered always-on-top window on startup', async () => {
        await setWindowAlwaysOnTop(true);
        expect(
            window.localStorage.getItem('vrcx-main-window-always-on-top')
        ).toBe('true');
        mocks.setWindowAlwaysOnTop.mockClear();

        await initializeWindowAlwaysOnTop();

        expect(mocks.setWindowAlwaysOnTop).toHaveBeenCalledWith(true);
    });

    it('leaves the window untouched on startup when it was not pinned', async () => {
        await initializeWindowAlwaysOnTop();

        expect(mocks.setWindowAlwaysOnTop).not.toHaveBeenCalled();
    });

    it('reverts the remembered always-on-top state when the window rejects it', async () => {
        mocks.setWindowAlwaysOnTop.mockRejectedValue(new Error('denied'));

        await expect(setWindowAlwaysOnTop(true)).rejects.toThrow('denied');

        expect(useShellStore.getState().windowAlwaysOnTop).toBe(false);
    });
});
