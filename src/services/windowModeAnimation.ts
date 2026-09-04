import { tauriClient } from '@/platform/tauri/client';
import type { WindowBounds } from '@/platform/tauri/webview';
import { usePreferencesStore } from '@/state/preferencesStore';

const WINDOW_MODE_ANIMATION_DURATION_MS = 160;

export type WindowAnimationBounds = WindowBounds;

function clampProgress(progress: number): number {
    return Math.min(1, Math.max(0, progress));
}

function cubicBezierCoordinate(
    progress: number,
    firstControlPoint: number,
    secondControlPoint: number
): number {
    const remaining = 1 - progress;
    return (
        3 * remaining * remaining * progress * firstControlPoint +
        3 * remaining * progress * progress * secondControlPoint +
        progress * progress * progress
    );
}

function cubicBezierDerivative(
    progress: number,
    firstControlPoint: number,
    secondControlPoint: number
): number {
    const remaining = 1 - progress;
    return (
        3 * remaining * remaining * firstControlPoint +
        6 * remaining * progress * (secondControlPoint - firstControlPoint) +
        3 * progress * progress * (1 - secondControlPoint)
    );
}

export function easeOutWindowProgress(progress: number): number {
    const input = clampProgress(progress);
    let curveProgress = input;
    for (let iteration = 0; iteration < 6; iteration += 1) {
        const difference =
            cubicBezierCoordinate(curveProgress, 0.23, 0.32) - input;
        const derivative = cubicBezierDerivative(curveProgress, 0.23, 0.32);
        if (Math.abs(derivative) < 0.000001) {
            break;
        }
        curveProgress = clampProgress(curveProgress - difference / derivative);
    }
    return cubicBezierCoordinate(curveProgress, 1, 1);
}

function interpolate(start: number, end: number, progress: number): number {
    return start + (end - start) * progress;
}

function shouldReduceWindowMotion(): boolean {
    if (usePreferencesStore.getState().reducedMotionAndBlur) {
        return true;
    }
    return (
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
}

export async function animateWindowBounds(
    start: WindowAnimationBounds,
    end: WindowAnimationBounds,
    allowAnimation = true
): Promise<void> {
    if (
        !allowAnimation ||
        shouldReduceWindowMotion() ||
        typeof window === 'undefined' ||
        typeof window.requestAnimationFrame !== 'function'
    ) {
        await tauriClient.webview.setWindowBounds(end);
        return;
    }

    const startedAt = performance.now();
    await new Promise<void>((resolve, reject) => {
        const step = (timestamp: number) => {
            const linearProgress = clampProgress(
                (timestamp - startedAt) / WINDOW_MODE_ANIMATION_DURATION_MS
            );
            const easedProgress = easeOutWindowProgress(linearProgress);
            void tauriClient.webview
                .setWindowBounds({
                    width: interpolate(start.width, end.width, easedProgress),
                    height: interpolate(
                        start.height,
                        end.height,
                        easedProgress
                    ),
                    x: interpolate(start.x, end.x, easedProgress),
                    y: interpolate(start.y, end.y, easedProgress)
                })
                .then(() => {
                    if (linearProgress >= 1) {
                        resolve();
                        return;
                    }
                    window.requestAnimationFrame(step);
                }, reject);
        };
        window.requestAnimationFrame(step);
    });
}
