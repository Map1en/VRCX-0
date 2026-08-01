import { normalizePlatformError } from './errors';

type WebviewWindowLike = {
    setZoom?: (zoom: number) => Promise<unknown> | unknown;
    scaleFactor?: (() => Promise<number> | number) | number;
};

export type WindowResizeDirection =
    | 'North'
    | 'NorthEast'
    | 'East'
    | 'SouthEast'
    | 'South'
    | 'SouthWest'
    | 'West'
    | 'NorthWest';

type WindowLike = {
    startDragging?: () => Promise<unknown> | unknown;
    startResizeDragging?: (
        direction: WindowResizeDirection
    ) => Promise<unknown> | unknown;
    minimize?: () => Promise<unknown> | unknown;
    toggleMaximize?: () => Promise<unknown> | unknown;
    close?: () => Promise<unknown> | unknown;
    isMaximized?: () => Promise<boolean> | boolean;
};

async function loadCurrentWebviewWindow() {
    try {
        const module = await import('@tauri-apps/api/webviewWindow');
        return module.getCurrentWebviewWindow;
    } catch (error) {
        throw normalizePlatformError(
            error,
            'Unable to load Tauri webviewWindow API'
        );
    }
}

async function loadCurrentWindow() {
    try {
        const module = await import('@tauri-apps/api/window');
        return module.getCurrentWindow;
    } catch (error) {
        throw normalizePlatformError(error, 'Unable to load Tauri window API');
    }
}

export async function getCurrentWebviewWindow(): Promise<WebviewWindowLike> {
    const getWindow = await loadCurrentWebviewWindow();
    return getWindow();
}

export async function getCurrentWindow(): Promise<WindowLike> {
    const getWindow = await loadCurrentWindow();
    return getWindow();
}

export async function setZoom(zoom: number): Promise<unknown> {
    const current = await getCurrentWebviewWindow();
    if (current && typeof current.setZoom === 'function') {
        return current.setZoom(zoom);
    }
    return undefined;
}

export async function getScaleFactor(): Promise<number | null> {
    const current = await getCurrentWebviewWindow();
    if (!current) {
        return null;
    }

    if (typeof current.scaleFactor === 'function') {
        return current.scaleFactor();
    }

    if (typeof current.scaleFactor === 'number') {
        return current.scaleFactor;
    }

    return null;
}

export async function startDraggingWindow(): Promise<unknown> {
    const current = await getCurrentWindow();
    if (current && typeof current.startDragging === 'function') {
        return current.startDragging();
    }
    return undefined;
}

export async function startResizeDraggingWindow(
    direction: WindowResizeDirection
): Promise<unknown> {
    const current = await getCurrentWindow();
    if (current && typeof current.startResizeDragging === 'function') {
        return current.startResizeDragging(direction);
    }
    return undefined;
}

export async function minimizeWindow(): Promise<unknown> {
    const current = await getCurrentWindow();
    if (current && typeof current.minimize === 'function') {
        return current.minimize();
    }
    return undefined;
}

export async function toggleMaximizeWindow(): Promise<unknown> {
    const current = await getCurrentWindow();
    if (current && typeof current.toggleMaximize === 'function') {
        return current.toggleMaximize();
    }
    return undefined;
}

export async function closeWindow(): Promise<unknown> {
    const current = await getCurrentWindow();
    if (current && typeof current.close === 'function') {
        return current.close();
    }
    return undefined;
}

export async function isWindowMaximized(): Promise<boolean> {
    const current = await getCurrentWindow();
    if (current && typeof current.isMaximized === 'function') {
        return current.isMaximized();
    }
    return false;
}

export const webview = Object.freeze({
    getCurrentWebviewWindow,
    getCurrentWindow,
    setZoom,
    getScaleFactor,
    startDraggingWindow,
    startResizeDraggingWindow,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    isWindowMaximized
});
