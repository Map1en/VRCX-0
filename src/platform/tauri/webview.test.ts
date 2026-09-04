import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadWebviewApi({
    currentWindow = null,
    currentWebviewWindow = null,
    currentMonitor = null,
    availableMonitors = []
}: {
    currentWindow?: object | null;
    currentWebviewWindow?: object | null;
    currentMonitor?: object | null;
    availableMonitors?: object[];
} = {}) {
    vi.resetModules();
    vi.doMock('@tauri-apps/api/window', () => ({
        getCurrentWindow: vi.fn(() => currentWindow),
        currentMonitor: vi.fn(() => currentMonitor),
        availableMonitors: vi.fn(() => availableMonitors),
        LogicalSize: class {
            constructor(
                public width: number,
                public height: number
            ) {}
        },
        PhysicalPosition: class {
            constructor(
                public x: number,
                public y: number
            ) {}
        },
        UserAttentionType: { Critical: 1, Informational: 2 }
    }));
    vi.doMock('@tauri-apps/api/webviewWindow', () => ({
        getCurrentWebviewWindow: vi.fn(() => currentWebviewWindow)
    }));

    return import('./webview');
}

afterEach(() => {
    vi.doUnmock('@tauri-apps/api/window');
    vi.doUnmock('@tauri-apps/api/webviewWindow');
    vi.resetModules();
});

describe('tauri webview wrappers', () => {
    it('delegates window control wrappers to the current Tauri window', async () => {
        const currentWindow = {
            startDragging: vi.fn(() => 'dragged'),
            minimize: vi.fn(() => 'minimized'),
            maximize: vi.fn(() => 'maximized'),
            unmaximize: vi.fn(() => 'unmaximized'),
            toggleMaximize: vi.fn(() => 'toggled'),
            close: vi.fn(() => 'closed'),
            isMaximized: vi.fn(() => true),
            setFocus: vi.fn(() => 'focused'),
            requestUserAttention: vi.fn(() => 'flashed'),
            setTheme: vi.fn(() => 'themed'),
            setMaximizable: vi.fn(() => 'maximizable'),
            setSizeConstraints: vi.fn(() => 'constrained'),
            setSize: vi.fn(() => 'sized'),
            setPosition: vi.fn(() => 'positioned'),
            innerSize: vi.fn(() => ({ width: 800, height: 600 })),
            outerSize: vi.fn(() => ({ width: 816, height: 638 })),
            outerPosition: vi.fn(() => ({ x: 100, y: 120 })),
            scaleFactor: vi.fn(() => 1.25)
        };
        const api = await loadWebviewApi({ currentWindow });

        await expect(api.startDraggingWindow()).resolves.toBe('dragged');
        await expect(api.minimizeWindow()).resolves.toBe('minimized');
        await expect(api.maximizeWindow()).resolves.toBe('maximized');
        await expect(api.unmaximizeWindow()).resolves.toBe('unmaximized');
        await expect(api.toggleMaximizeWindow()).resolves.toBe('toggled');
        await expect(api.closeWindow()).resolves.toBe('closed');
        await expect(api.isWindowMaximized()).resolves.toBe(true);
        await expect(api.focusWindow()).resolves.toBe('focused');
        await expect(api.flashWindow()).resolves.toBe('flashed');
        await expect(api.setWindowTheme('dark')).resolves.toBe('themed');
        await expect(api.setWindowMaximizable(false)).resolves.toBe(
            'maximizable'
        );
        await expect(
            api.setWindowSizeConstraints({
                minWidth: 320,
                minHeight: 240,
                maxWidth: 800
            })
        ).resolves.toBe('constrained');
        await expect(
            api.setWindowBounds({
                width: 480,
                height: 720,
                x: 300.4,
                y: 199.6
            })
        ).resolves.toBeUndefined();
        await expect(api.setWindowPhysicalPosition(300.4, 199.6)).resolves.toBe(
            'positioned'
        );
        await expect(api.getWindowGeometry()).resolves.toMatchObject({
            innerSize: { width: 800, height: 600 },
            outerSize: { width: 816, height: 638 },
            outerPosition: { x: 100, y: 120 },
            scaleFactor: 1.25,
            maximized: true
        });

        expect(currentWindow.startDragging).toHaveBeenCalledOnce();
        expect(currentWindow.minimize).toHaveBeenCalledOnce();
        expect(currentWindow.maximize).toHaveBeenCalledOnce();
        expect(currentWindow.unmaximize).toHaveBeenCalledOnce();
        expect(currentWindow.toggleMaximize).toHaveBeenCalledOnce();
        expect(currentWindow.close).toHaveBeenCalledOnce();
        expect(currentWindow.isMaximized).toHaveBeenCalledTimes(2);
        expect(currentWindow.setFocus).toHaveBeenCalledOnce();
        expect(currentWindow.requestUserAttention).toHaveBeenCalledWith(2);
        expect(currentWindow.setTheme).toHaveBeenCalledWith('dark');
        expect(currentWindow.setPosition).toHaveBeenCalledWith({
            x: 300,
            y: 200
        });
    });

    it('uses safe fallbacks when optional window methods are unavailable', async () => {
        const api = await loadWebviewApi({ currentWindow: {} });

        await expect(api.startDraggingWindow()).resolves.toBeUndefined();
        await expect(api.minimizeWindow()).resolves.toBeUndefined();
        await expect(api.maximizeWindow()).resolves.toBeUndefined();
        await expect(api.unmaximizeWindow()).resolves.toBeUndefined();
        await expect(api.toggleMaximizeWindow()).resolves.toBeUndefined();
        await expect(api.closeWindow()).resolves.toBeUndefined();
        await expect(api.isWindowMaximized()).resolves.toBe(false);
        await expect(api.focusWindow()).resolves.toBeUndefined();
        await expect(api.flashWindow()).resolves.toBeUndefined();
        await expect(api.setWindowTheme(null)).resolves.toBeUndefined();
        await expect(api.setWindowMaximizable(true)).resolves.toBeUndefined();
        await expect(
            api.setWindowSizeConstraints({ minWidth: 320 })
        ).resolves.toBeUndefined();
        await expect(
            api.setWindowBounds({ width: 400, height: 600, x: 0, y: 0 })
        ).resolves.toBeUndefined();
        await expect(
            api.setWindowPhysicalPosition(0, 0)
        ).resolves.toBeUndefined();
        await expect(api.getWindowGeometry()).resolves.toBeNull();
    });

    it('normalizes Tauri window import failures', async () => {
        vi.resetModules();
        vi.doMock('@tauri-apps/api/window', () => {
            throw new TypeError('window module missing');
        });
        const api = await import('./webview');

        await expect(api.minimizeWindow()).rejects.toMatchObject({
            message: expect.stringContaining('Unable to load Tauri window API:')
        });
    });
});
