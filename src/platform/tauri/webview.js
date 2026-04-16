import { normalizePlatformError } from './errors.js';

async function loadCurrentWebviewWindow() {
    try {
        const module = await import('@tauri-apps/api/webviewWindow');
        return module.getCurrentWebviewWindow;
    } catch (error) {
        throw normalizePlatformError(error, 'Unable to load Tauri webviewWindow API');
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

export async function getCurrentWebviewWindow() {
    const getWindow = await loadCurrentWebviewWindow();
    return getWindow();
}

export async function getCurrentWindow() {
    const getWindow = await loadCurrentWindow();
    return getWindow();
}

export async function setZoom(zoom) {
    const current = await getCurrentWebviewWindow();
    if (current && typeof current.setZoom === 'function') {
        return current.setZoom(zoom);
    }
    return undefined;
}

export async function getScaleFactor() {
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

export async function startDraggingWindow() {
    const current = await getCurrentWindow();
    if (current && typeof current.startDragging === 'function') {
        return current.startDragging();
    }
    return undefined;
}

export async function minimizeWindow() {
    const current = await getCurrentWindow();
    if (current && typeof current.minimize === 'function') {
        return current.minimize();
    }
    return undefined;
}

export async function toggleMaximizeWindow() {
    const current = await getCurrentWindow();
    if (current && typeof current.toggleMaximize === 'function') {
        return current.toggleMaximize();
    }
    return undefined;
}

export async function closeWindow() {
    const current = await getCurrentWindow();
    if (current && typeof current.close === 'function') {
        return current.close();
    }
    return undefined;
}

export async function isWindowMaximized() {
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
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    isWindowMaximized
});
