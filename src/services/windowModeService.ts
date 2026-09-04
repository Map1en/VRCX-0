import { tauriClient } from '@/platform/tauri/client';
import { tauriEvents } from '@/platform/tauri/events';
import type { WindowGeometry, WindowWorkArea } from '@/platform/tauri/webview';
import { isRecord } from '@/shared/utils/record';
import { useShellStore } from '@/state/shellStore';

import { suspendSidebarAutoHide } from './sidebarAutoHideService';
import {
    animateWindowBounds,
    type WindowAnimationBounds
} from './windowModeAnimation';

const SIDEBAR_WINDOW_MIN_WIDTH = 320;
const SIDEBAR_WINDOW_MAX_WIDTH = 600;
const DEFAULT_SIDEBAR_WINDOW_WIDTH = 360;

const NORMAL_WINDOW_MIN_HEIGHT = 240;
const DEFAULT_NORMAL_WINDOW_WIDTH = 1024;
const NORMAL_WINDOW_BOUNDS_STORAGE_KEY = 'vrcx-main-window-normal-bounds';
const SIDEBAR_WINDOW_WIDTH_STORAGE_KEY = 'vrcx-main-window-sidebar-width';

type SavedNormalWindowBounds = {
    version: 1;
    x: number;
    y: number;
    width: number;
};

let windowModeTransition = Promise.resolve();

function queueWindowModeTransition(action: () => Promise<void>): Promise<void> {
    const result = windowModeTransition.then(action, action);
    windowModeTransition = result.catch(() => undefined);
    return result;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function readStoredValue(key: string): string {
    if (typeof window === 'undefined') {
        return '';
    }
    try {
        return window.localStorage.getItem(key) ?? '';
    } catch {
        return '';
    }
}

function writeStoredValue(key: string, value: string): void {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(key, value);
    } catch {
        return;
    }
}

function readSavedNormalWindowBounds(): SavedNormalWindowBounds | null {
    const raw = readStoredValue(NORMAL_WINDOW_BOUNDS_STORAGE_KEY);
    if (!raw) {
        return null;
    }
    try {
        const value: unknown = JSON.parse(raw);
        if (
            !isRecord(value) ||
            value.version !== 1 ||
            typeof value.x !== 'number' ||
            typeof value.y !== 'number' ||
            typeof value.width !== 'number' ||
            !Number.isFinite(value.x) ||
            !Number.isFinite(value.y) ||
            !Number.isFinite(value.width) ||
            value.width < SIDEBAR_WINDOW_MIN_WIDTH
        ) {
            return null;
        }
        return {
            version: 1,
            x: value.x,
            y: value.y,
            width: value.width
        };
    } catch {
        return null;
    }
}

function saveNormalWindowBounds(geometry: WindowGeometry): void {
    const bounds: SavedNormalWindowBounds = {
        version: 1,
        x: geometry.outerPosition.x,
        y: geometry.outerPosition.y,
        width: geometry.innerSize.width / geometry.scaleFactor
    };
    writeStoredValue(NORMAL_WINDOW_BOUNDS_STORAGE_KEY, JSON.stringify(bounds));
}

function readSidebarWindowWidth(): number | null {
    const width = Number.parseFloat(
        readStoredValue(SIDEBAR_WINDOW_WIDTH_STORAGE_KEY)
    );
    return Number.isFinite(width)
        ? clamp(width, SIDEBAR_WINDOW_MIN_WIDTH, SIDEBAR_WINDOW_MAX_WIDTH)
        : null;
}

function saveSidebarWindowWidth(geometry: WindowGeometry): void {
    const width = clamp(
        geometry.innerSize.width / geometry.scaleFactor,
        SIDEBAR_WINDOW_MIN_WIDTH,
        SIDEBAR_WINDOW_MAX_WIDTH
    );
    writeStoredValue(SIDEBAR_WINDOW_WIDTH_STORAGE_KEY, String(width));
}

function containsPoint(area: WindowWorkArea, x: number, y: number): boolean {
    return (
        x >= area.x &&
        y >= area.y &&
        x < area.x + area.width &&
        y < area.y + area.height
    );
}

function resolveRestoreWorkArea(
    geometry: WindowGeometry,
    x: number,
    y: number
): WindowWorkArea | null {
    return (
        geometry.workAreas.find((area) => containsPoint(area, x, y)) ??
        geometry.currentWorkArea
    );
}

function clampPositionToWorkArea(
    area: WindowWorkArea,
    outerWidth: number,
    outerHeight: number,
    x: number,
    y: number
): { x: number; y: number } {
    return {
        x: clamp(x, area.x, Math.max(area.x, area.x + area.width - outerWidth)),
        y: clamp(
            y,
            area.y,
            Math.max(area.y, area.y + area.height - outerHeight)
        )
    };
}

function toWindowAnimationBounds(
    geometry: WindowGeometry
): WindowAnimationBounds {
    return {
        width: geometry.innerSize.width / geometry.scaleFactor,
        height: geometry.innerSize.height / geometry.scaleFactor,
        x: geometry.outerPosition.x,
        y: geometry.outerPosition.y
    };
}

function resolveSidebarWindowTarget(
    geometry: WindowGeometry,
    width: number
): { bounds: WindowAnimationBounds; rightEdge: number } {
    const rightEdge = geometry.outerPosition.x + geometry.outerSize.width;
    const targetOuterWidth =
        width * geometry.scaleFactor +
        geometry.outerSize.width -
        geometry.innerSize.width;
    const targetPosition = geometry.currentWorkArea
        ? clampPositionToWorkArea(
              geometry.currentWorkArea,
              targetOuterWidth,
              geometry.outerSize.height,
              rightEdge - targetOuterWidth,
              geometry.outerPosition.y
          )
        : {
              x: rightEdge - targetOuterWidth,
              y: geometry.outerPosition.y
          };
    return {
        bounds: {
            width,
            height: geometry.innerSize.height / geometry.scaleFactor,
            x: targetPosition.x,
            y: targetPosition.y
        },
        rightEdge
    };
}

function isSameWorkArea(
    first: WindowWorkArea | null,
    second: WindowWorkArea | null
): boolean {
    return Boolean(
        first &&
        second &&
        first.x === second.x &&
        first.y === second.y &&
        first.width === second.width &&
        first.height === second.height &&
        first.scaleFactor === second.scaleFactor
    );
}

function resolveInitialRestorePosition(
    savedBounds: SavedNormalWindowBounds | null,
    targetArea: WindowWorkArea | null,
    targetWidth: number,
    fallbackGeometry: WindowGeometry
): { x: number; y: number } {
    if (
        savedBounds &&
        targetArea &&
        containsPoint(targetArea, savedBounds.x, savedBounds.y)
    ) {
        return { x: savedBounds.x, y: fallbackGeometry.outerPosition.y };
    }
    if (!targetArea) {
        return fallbackGeometry.outerPosition;
    }
    const targetOuterWidth =
        targetWidth * targetArea.scaleFactor +
        fallbackGeometry.outerSize.width -
        fallbackGeometry.innerSize.width;
    return {
        x: targetArea.x + Math.round((targetArea.width - targetOuterWidth) / 2),
        y: fallbackGeometry.outerPosition.y
    };
}

async function readRestoredGeometry(
    geometry: WindowGeometry
): Promise<WindowGeometry> {
    if (geometry.maximized) {
        await tauriClient.webview.unmaximizeWindow();
        const restoredGeometry = await tauriClient.webview.getWindowGeometry();
        if (!restoredGeometry) {
            throw new Error(
                'Unable to read the restored main window geometry.'
            );
        }
        return restoredGeometry;
    }
    return geometry;
}

async function applyNormalWindowConstraints(): Promise<void> {
    await Promise.all([
        tauriClient.webview.setWindowMaximizable(true),
        tauriClient.webview.setWindowSizeConstraints({
            minWidth: SIDEBAR_WINDOW_MIN_WIDTH,
            minHeight: NORMAL_WINDOW_MIN_HEIGHT
        })
    ]);
}

async function applySidebarWindowSizeConstraints(): Promise<void> {
    await tauriClient.webview.setWindowSizeConstraints({
        minWidth: SIDEBAR_WINDOW_MIN_WIDTH,
        minHeight: NORMAL_WINDOW_MIN_HEIGHT,
        maxWidth: SIDEBAR_WINDOW_MAX_WIDTH
    });
}

async function applySidebarWindowConstraints(): Promise<void> {
    await Promise.all([
        tauriClient.webview.setWindowMaximizable(false),
        applySidebarWindowSizeConstraints()
    ]);
}

async function restoreCapturedNormalWindow(
    geometry: WindowGeometry,
    maximized: boolean
): Promise<void> {
    await applyNormalWindowConstraints();
    await tauriClient.webview.setWindowBounds({
        width: geometry.innerSize.width / geometry.scaleFactor,
        height: geometry.innerSize.height / geometry.scaleFactor,
        x: geometry.outerPosition.x,
        y: geometry.outerPosition.y
    });
    if (maximized) {
        await tauriClient.webview.maximizeWindow();
    }
}

async function restoreCapturedSidebarWindow(
    geometry: WindowGeometry | null
): Promise<void> {
    try {
        if (geometry) {
            await tauriClient.webview.setWindowBounds(
                toWindowAnimationBounds(geometry)
            );
        }
    } finally {
        await applySidebarWindowConstraints();
    }
}

async function resumeSidebarAutoHide(): Promise<void> {
    await suspendSidebarAutoHide(false).catch((error: unknown) => {
        console.warn('Failed to resume sidebar auto-hide:', error);
    });
}

export function initializeWindowDisplayMode(): Promise<void> {
    return queueWindowModeTransition(async () => {
        await suspendSidebarAutoHide(true);
        try {
            if (useShellStore.getState().windowDisplayMode === 'sidebar') {
                let geometry: WindowGeometry | null = null;
                try {
                    await tauriClient.webview.unmaximizeWindow();
                    geometry = await tauriClient.webview.getWindowGeometry();
                } finally {
                    await applySidebarWindowConstraints();
                }
                if (!geometry) {
                    return;
                }
                const currentWidth =
                    geometry.innerSize.width / geometry.scaleFactor;
                if (
                    currentWidth >= SIDEBAR_WINDOW_MIN_WIDTH &&
                    currentWidth <= SIDEBAR_WINDOW_MAX_WIDTH
                ) {
                    return;
                }
                const targetWidth =
                    readSidebarWindowWidth() ??
                    clamp(
                        currentWidth,
                        SIDEBAR_WINDOW_MIN_WIDTH,
                        SIDEBAR_WINDOW_MAX_WIDTH
                    );
                await tauriClient.webview.setWindowBounds(
                    resolveSidebarWindowTarget(geometry, targetWidth).bounds
                );
                return;
            }
            await applyNormalWindowConstraints();
        } finally {
            await resumeSidebarAutoHide();
        }
    });
}

export function enterSidebarWindowMode(
    preferredWidth = DEFAULT_SIDEBAR_WINDOW_WIDTH
): Promise<void> {
    if (useShellStore.getState().windowDisplayMode === 'sidebar') {
        return Promise.resolve();
    }
    useShellStore.getState().setWindowDisplayMode('sidebar');

    return queueWindowModeTransition(async () => {
        let initialWasMaximized = false;
        let capturedNormalGeometry: WindowGeometry | null = null;
        try {
            await suspendSidebarAutoHide(true);
            const initialGeometry =
                await tauriClient.webview.getWindowGeometry();
            if (!initialGeometry) {
                throw new Error('Unable to read the main window geometry.');
            }
            initialWasMaximized = initialGeometry.maximized;
            const normalGeometry = await readRestoredGeometry(initialGeometry);
            capturedNormalGeometry = normalGeometry;
            saveNormalWindowBounds(normalGeometry);

            const sidebarWidth = clamp(
                readSidebarWindowWidth() ?? preferredWidth,
                SIDEBAR_WINDOW_MIN_WIDTH,
                SIDEBAR_WINDOW_MAX_WIDTH
            );
            const target = resolveSidebarWindowTarget(
                normalGeometry,
                sidebarWidth
            );

            await tauriClient.webview.setWindowMaximizable(false);
            await animateWindowBounds(
                toWindowAnimationBounds(normalGeometry),
                target.bounds
            );
            await applySidebarWindowSizeConstraints();

            const sidebarGeometry =
                await tauriClient.webview.getWindowGeometry();
            if (!sidebarGeometry) {
                return;
            }
            const sidebarWorkArea = sidebarGeometry.currentWorkArea;
            const clampedPosition = sidebarWorkArea
                ? clampPositionToWorkArea(
                      sidebarWorkArea,
                      sidebarGeometry.outerSize.width,
                      sidebarGeometry.outerSize.height,
                      target.rightEdge - sidebarGeometry.outerSize.width,
                      normalGeometry.outerPosition.y
                  )
                : {
                      x: target.rightEdge - sidebarGeometry.outerSize.width,
                      y: normalGeometry.outerPosition.y
                  };
            await tauriClient.webview.setWindowPhysicalPosition(
                clampedPosition.x,
                clampedPosition.y
            );
        } catch (error) {
            useShellStore.getState().setWindowDisplayMode('normal');
            if (capturedNormalGeometry) {
                await restoreCapturedNormalWindow(
                    capturedNormalGeometry,
                    initialWasMaximized
                ).catch(() => undefined);
            } else {
                await applyNormalWindowConstraints().catch(() => undefined);
                if (initialWasMaximized) {
                    await tauriClient.webview
                        .maximizeWindow()
                        .catch(() => undefined);
                }
            }
            throw error;
        } finally {
            await resumeSidebarAutoHide();
        }
    });
}

export function restoreNormalWindowMode(remember = true): Promise<void> {
    if (useShellStore.getState().windowDisplayMode === 'normal') {
        return Promise.resolve();
    }
    useShellStore.getState().setWindowDisplayMode('normal', remember);

    return queueWindowModeTransition(async () => {
        let compactGeometry: WindowGeometry | null = null;
        try {
            await suspendSidebarAutoHide(true);
            compactGeometry = await tauriClient.webview.getWindowGeometry();
            if (!compactGeometry) {
                throw new Error('Unable to read the current window geometry.');
            }
            saveSidebarWindowWidth(compactGeometry);
            await applyNormalWindowConstraints();

            const savedBounds = readSavedNormalWindowBounds();
            const targetArea = resolveRestoreWorkArea(
                compactGeometry,
                savedBounds?.x ?? compactGeometry.outerPosition.x,
                savedBounds?.y ?? compactGeometry.outerPosition.y
            );
            const scaleFactor =
                targetArea?.scaleFactor ?? compactGeometry.scaleFactor;
            const targetWidth = Math.min(
                savedBounds?.width ?? DEFAULT_NORMAL_WINDOW_WIDTH,
                targetArea
                    ? targetArea.width / scaleFactor
                    : Number.POSITIVE_INFINITY
            );
            const targetHeight =
                compactGeometry.innerSize.height / compactGeometry.scaleFactor;
            const initialPosition = resolveInitialRestorePosition(
                savedBounds,
                targetArea,
                targetWidth,
                compactGeometry
            );

            await animateWindowBounds(
                toWindowAnimationBounds(compactGeometry),
                {
                    width: targetWidth,
                    height: targetHeight,
                    x: initialPosition.x,
                    y: initialPosition.y
                },
                isSameWorkArea(compactGeometry.currentWorkArea, targetArea)
            );

            const restoredGeometry =
                await tauriClient.webview.getWindowGeometry();
            if (restoredGeometry && targetArea) {
                const targetPosition = clampPositionToWorkArea(
                    targetArea,
                    restoredGeometry.outerSize.width,
                    restoredGeometry.outerSize.height,
                    initialPosition.x,
                    initialPosition.y
                );
                await tauriClient.webview.setWindowPhysicalPosition(
                    targetPosition.x,
                    targetPosition.y
                );
            }
        } catch (error) {
            useShellStore.getState().setWindowDisplayMode('sidebar', remember);
            await restoreCapturedSidebarWindow(compactGeometry).catch(
                () => undefined
            );
            throw error;
        } finally {
            await resumeSidebarAutoHide();
        }
    });
}

let sidebarModeSuspendedForLogin = false;

export function leaveSidebarWindowModeForLogin(): void {
    if (useShellStore.getState().windowDisplayMode !== 'sidebar') {
        return;
    }
    sidebarModeSuspendedForLogin = true;
    void restoreNormalWindowMode(false).catch((error: unknown) => {
        console.warn('Failed to restore the full window:', error);
    });
}

export function restoreSidebarWindowModeAfterLogin(): void {
    if (!sidebarModeSuspendedForLogin) {
        return;
    }
    sidebarModeSuspendedForLogin = false;
    void enterSidebarWindowMode().catch((error: unknown) => {
        console.warn('Failed to return to the sidebar window:', error);
    });
}

export function subscribeSidebarModeToggle(): Promise<() => void> {
    return tauriEvents.subscribe('sidebarModeToggleRequested', () => {
        const sidebar =
            useShellStore.getState().windowDisplayMode === 'sidebar';
        const transition = sidebar
            ? restoreNormalWindowMode()
            : enterSidebarWindowMode();
        void transition.catch((error: unknown) => {
            console.warn('Failed to toggle the sidebar window mode:', error);
        });
    });
}

export function restoreNormalWindowModeForIntent(): void {
    void restoreNormalWindowMode().catch((error: unknown) => {
        console.warn('Failed to restore the full window:', error);
    });
}

export function runAfterRestoringNormalWindow(action: () => void): void {
    if (useShellStore.getState().windowDisplayMode === 'normal') {
        action();
        return;
    }
    void restoreNormalWindowMode()
        .then(action)
        .catch((error: unknown) => {
            console.warn('Failed to restore the full window:', error);
        });
}
