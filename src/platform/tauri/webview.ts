import type { Window as TauriWindow } from '@tauri-apps/api/window';

import { normalizePlatformError } from './errors';

type WindowSizeInput = Parameters<TauriWindow['setSize']>[0];
type WindowPositionInput = Parameters<TauriWindow['setPosition']>[0];

type WebviewWindowLike = {
    setZoom?: (zoom: number) => Promise<void>;
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

export type WindowTheme = 'light' | 'dark';

type WindowLike = {
    startDragging?: () => Promise<void>;
    startResizeDragging?: (direction: WindowResizeDirection) => Promise<void>;
    minimize?: () => Promise<void>;
    maximize?: () => Promise<void>;
    unmaximize?: () => Promise<void>;
    toggleMaximize?: () => Promise<void>;
    close?: () => Promise<void>;
    isMaximized?: () => Promise<boolean> | boolean;
    innerSize?: () => Promise<WindowPhysicalSize>;
    outerSize?: () => Promise<WindowPhysicalSize>;
    outerPosition?: () => Promise<WindowPhysicalPosition>;
    scaleFactor?: () => Promise<number> | number;
    setSize?: (size: WindowSizeInput) => Promise<void>;
    setPosition?: (position: WindowPositionInput) => Promise<void>;
    setSizeConstraints?: (
        constraints: WindowSizeConstraints | null
    ) => Promise<void>;
    setMaximizable?: (maximizable: boolean) => Promise<void>;
    setFocus?: () => Promise<void>;
    requestUserAttention?: (requestType: number | null) => Promise<void>;
    setTheme?: (theme: WindowTheme | null) => Promise<void>;
};

export type WindowPhysicalPosition = {
    x: number;
    y: number;
};

export type WindowPhysicalSize = {
    width: number;
    height: number;
};

export type WindowSizeConstraints = {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
};

export type WindowBounds = {
    width: number;
    height: number;
    x: number;
    y: number;
};

export type WindowWorkArea = WindowPhysicalPosition &
    WindowPhysicalSize & {
        scaleFactor: number;
    };

export type WindowGeometry = {
    innerSize: WindowPhysicalSize;
    outerSize: WindowPhysicalSize;
    outerPosition: WindowPhysicalPosition;
    scaleFactor: number;
    maximized: boolean;
    currentWorkArea: WindowWorkArea | null;
    workAreas: WindowWorkArea[];
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

async function loadWindowModule() {
    try {
        return await import('@tauri-apps/api/window');
    } catch (error) {
        throw normalizePlatformError(error, 'Unable to load Tauri window API');
    }
}

async function loadCurrentWindow() {
    const module = await loadWindowModule();
    return module.getCurrentWindow;
}

export async function getCurrentWebviewWindow(): Promise<WebviewWindowLike> {
    const getWindow = await loadCurrentWebviewWindow();
    return getWindow();
}

export async function getCurrentWindow(): Promise<WindowLike> {
    const getWindow = await loadCurrentWindow();
    return getWindow();
}

export async function setZoom(zoom: number): Promise<void> {
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

export async function startDraggingWindow(): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.startDragging === 'function') {
        return current.startDragging();
    }
    return undefined;
}

export async function startResizeDraggingWindow(
    direction: WindowResizeDirection
): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.startResizeDragging === 'function') {
        return current.startResizeDragging(direction);
    }
    return undefined;
}

export async function minimizeWindow(): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.minimize === 'function') {
        return current.minimize();
    }
    return undefined;
}

export async function toggleMaximizeWindow(): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.toggleMaximize === 'function') {
        return current.toggleMaximize();
    }
    return undefined;
}

export async function maximizeWindow(): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.maximize === 'function') {
        return current.maximize();
    }
    return undefined;
}

export async function unmaximizeWindow(): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.unmaximize === 'function') {
        return current.unmaximize();
    }
    return undefined;
}

export async function closeWindow(): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.close === 'function') {
        return current.close();
    }
    return undefined;
}

export async function focusWindow(): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.setFocus === 'function') {
        return current.setFocus();
    }
    return undefined;
}

export async function flashWindow(): Promise<void> {
    const module = await loadWindowModule();
    const current: WindowLike = module.getCurrentWindow();
    if (current && typeof current.requestUserAttention === 'function') {
        return current.requestUserAttention(
            module.UserAttentionType.Informational
        );
    }
    return undefined;
}

export async function setWindowTheme(theme: WindowTheme | null): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.setTheme === 'function') {
        return current.setTheme(theme);
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

function toWindowWorkArea(monitor: {
    scaleFactor: number;
    workArea: {
        position: WindowPhysicalPosition;
        size: WindowPhysicalSize;
    };
}): WindowWorkArea {
    return {
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
        scaleFactor: monitor.scaleFactor
    };
}

export async function getWindowGeometry(): Promise<WindowGeometry | null> {
    const module = await loadWindowModule();
    const current: WindowLike = module.getCurrentWindow();
    if (
        !current ||
        typeof current.innerSize !== 'function' ||
        typeof current.outerSize !== 'function' ||
        typeof current.outerPosition !== 'function'
    ) {
        return null;
    }

    const [innerSize, outerSize, outerPosition, scaleFactor, maximized] =
        await Promise.all([
            current.innerSize(),
            current.outerSize(),
            current.outerPosition(),
            typeof current.scaleFactor === 'function'
                ? current.scaleFactor()
                : 1,
            typeof current.isMaximized === 'function'
                ? current.isMaximized()
                : false
        ]);
    const [currentMonitor, monitors] = await Promise.all([
        module.currentMonitor(),
        module.availableMonitors()
    ]);

    return {
        innerSize,
        outerSize,
        outerPosition,
        scaleFactor:
            Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1,
        maximized: Boolean(maximized),
        currentWorkArea: currentMonitor
            ? toWindowWorkArea(currentMonitor)
            : null,
        workAreas: monitors.map(toWindowWorkArea)
    };
}

export async function setWindowPhysicalPosition(
    x: number,
    y: number
): Promise<void> {
    const module = await loadWindowModule();
    const current: WindowLike = module.getCurrentWindow();
    if (current && typeof current.setPosition === 'function') {
        return current.setPosition(
            new module.PhysicalPosition(Math.round(x), Math.round(y))
        );
    }
    return undefined;
}

export async function setWindowBounds(bounds: WindowBounds): Promise<void> {
    const module = await loadWindowModule();
    const current: WindowLike = module.getCurrentWindow();
    const actions: Promise<void>[] = [];
    if (current && typeof current.setSize === 'function') {
        actions.push(
            current.setSize(new module.LogicalSize(bounds.width, bounds.height))
        );
    }
    if (current && typeof current.setPosition === 'function') {
        actions.push(
            current.setPosition(
                new module.PhysicalPosition(
                    Math.round(bounds.x),
                    Math.round(bounds.y)
                )
            )
        );
    }
    await Promise.all(actions);
}

export async function setWindowSizeConstraints(
    constraints: WindowSizeConstraints
): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.setSizeConstraints === 'function') {
        return current.setSizeConstraints(constraints);
    }
    return undefined;
}

export async function setWindowMaximizable(
    maximizable: boolean
): Promise<void> {
    const current = await getCurrentWindow();
    if (current && typeof current.setMaximizable === 'function') {
        return current.setMaximizable(maximizable);
    }
    return undefined;
}

export const webview = Object.freeze({
    getCurrentWebviewWindow,
    getCurrentWindow,
    setZoom,
    getScaleFactor,
    startDraggingWindow,
    startResizeDraggingWindow,
    minimizeWindow,
    maximizeWindow,
    unmaximizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    focusWindow,
    flashWindow,
    setWindowTheme,
    isWindowMaximized,
    getWindowGeometry,
    setWindowPhysicalPosition,
    setWindowBounds,
    setWindowSizeConstraints,
    setWindowMaximizable
});
