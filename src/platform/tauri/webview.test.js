import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadWebviewApi({ currentWindow = null, currentWebviewWindow = null } = {}) {
    vi.resetModules();
    vi.doMock('@tauri-apps/api/window', () => ({
        getCurrentWindow: vi.fn(() => currentWindow)
    }));
    vi.doMock('@tauri-apps/api/webviewWindow', () => ({
        getCurrentWebviewWindow: vi.fn(() => currentWebviewWindow)
    }));

    return import('./webview.js');
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
            toggleMaximize: vi.fn(() => 'toggled'),
            close: vi.fn(() => 'closed'),
            isMaximized: vi.fn(() => true)
        };
        const api = await loadWebviewApi({ currentWindow });

        await expect(api.startDraggingWindow()).resolves.toBe('dragged');
        await expect(api.minimizeWindow()).resolves.toBe('minimized');
        await expect(api.toggleMaximizeWindow()).resolves.toBe('toggled');
        await expect(api.closeWindow()).resolves.toBe('closed');
        await expect(api.isWindowMaximized()).resolves.toBe(true);

        expect(currentWindow.startDragging).toHaveBeenCalledOnce();
        expect(currentWindow.minimize).toHaveBeenCalledOnce();
        expect(currentWindow.toggleMaximize).toHaveBeenCalledOnce();
        expect(currentWindow.close).toHaveBeenCalledOnce();
        expect(currentWindow.isMaximized).toHaveBeenCalledOnce();
    });

    it('uses safe fallbacks when optional window methods are unavailable', async () => {
        const api = await loadWebviewApi({ currentWindow: {} });

        await expect(api.startDraggingWindow()).resolves.toBeUndefined();
        await expect(api.minimizeWindow()).resolves.toBeUndefined();
        await expect(api.toggleMaximizeWindow()).resolves.toBeUndefined();
        await expect(api.closeWindow()).resolves.toBeUndefined();
        await expect(api.isWindowMaximized()).resolves.toBe(false);
    });

    it('normalizes Tauri window import failures', async () => {
        vi.resetModules();
        vi.doMock('@tauri-apps/api/window', () => {
            throw new TypeError('window module missing');
        });
        const api = await import('./webview.js');

        await expect(api.minimizeWindow()).rejects.toMatchObject({
            message: expect.stringContaining('Unable to load Tauri window API:')
        });
    });
});
