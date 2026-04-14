import { normalizePlatformError } from './errors.js';

async function loadCurrentWebviewWindow() {
    try {
        const module = await import('@tauri-apps/api/webviewWindow');
        return module.getCurrentWebviewWindow;
    } catch (error) {
        throw normalizePlatformError(error, 'Unable to load Tauri webviewWindow API');
    }
}

export async function getCurrentWebviewWindow() {
    const getWindow = await loadCurrentWebviewWindow();
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

export const webview = Object.freeze({
    getCurrentWebviewWindow,
    setZoom,
    getScaleFactor
});
