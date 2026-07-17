import { useBackgroundImageStore } from '@/state/backgroundImageStore';

import { isBackgroundImageCustomSourceRotating } from './localSourceService';
import type { BackgroundImageRotationInterval } from './types';

let rotationTimer: ReturnType<typeof setTimeout> | null = null;

export function clearBackgroundImageRotationTimer(): void {
    if (rotationTimer) {
        window.clearTimeout(rotationTimer);
        rotationTimer = null;
    }
}

function msUntilNextRotation(
    interval: BackgroundImageRotationInterval
): number {
    const now = new Date();
    const next = new Date(now);
    if (interval === 'hourly') {
        next.setHours(now.getHours() + 1, 0, 2, 0);
        return Math.max(1_000, next.getTime() - now.getTime());
    }

    next.setDate(now.getDate() + 1);
    next.setHours(0, 0, 2, 0);
    return Math.max(1_000, next.getTime() - now.getTime());
}

export function scheduleBackgroundImageRotation(
    refreshBackgroundImage: () => Promise<boolean>
): void {
    clearBackgroundImageRotationTimer();
    if (typeof window === 'undefined') {
        return;
    }

    const state = useBackgroundImageStore.getState();
    if (
        !state.enabled ||
        state.mode !== 'custom' ||
        !isBackgroundImageCustomSourceRotating(
            state.customSource,
            state.snapshot?.imageCount
        )
    ) {
        return;
    }

    const interval = state.customSource?.rotationInterval || 'daily';
    rotationTimer = window.setTimeout(() => {
        refreshBackgroundImage().catch((error) => {
            console.warn('Failed to refresh Background Image rotation:', error);
        });
    }, msUntilNextRotation(interval));
}
