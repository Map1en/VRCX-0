// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WindowBounds } from '@/platform/tauri/webview';

const mocks = vi.hoisted(() => ({
    setWindowBounds: vi.fn<(bounds: WindowBounds) => Promise<void>>()
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        webview: mocks
    }
}));

import { usePreferencesStore } from '@/state/preferencesStore';

import {
    animateWindowBounds,
    easeOutWindowProgress
} from './windowModeAnimation';

const animationFrames: FrameRequestCallback[] = [];

async function runAnimationFrame(timestamp: number): Promise<void> {
    const callback = animationFrames.shift();
    if (!callback) {
        throw new Error('No animation frame is scheduled.');
    }
    callback(timestamp);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    animationFrames.length = 0;
    mocks.setWindowBounds.mockReset().mockResolvedValue(undefined);
    usePreferencesStore.setState({ reducedMotionAndBlur: false });
    vi.spyOn(performance, 'now').mockReturnValue(0);
    Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        value: vi.fn((callback: FrameRequestCallback) => {
            animationFrames.push(callback);
            return animationFrames.length;
        })
    });
});

afterEach(() => {
    usePreferencesStore.setState({ reducedMotionAndBlur: false });
    vi.restoreAllMocks();
});

describe('windowModeAnimation', () => {
    it('uses the project ease-out curve endpoints', () => {
        expect(easeOutWindowProgress(0)).toBe(0);
        expect(easeOutWindowProgress(0.5)).toBeGreaterThan(0.5);
        expect(easeOutWindowProgress(1)).toBe(1);
    });

    it('interpolates native window bounds over 160ms', async () => {
        const animation = animateWindowBounds(
            { width: 1200, height: 800, x: 100, y: 100 },
            { width: 480, height: 800, x: 820, y: 100 }
        );

        await runAnimationFrame(80);

        const intermediateBounds = mocks.setWindowBounds.mock.calls[0][0];
        expect(intermediateBounds.width).toBeGreaterThan(480);
        expect(intermediateBounds.width).toBeLessThan(1200);
        expect(animationFrames).toHaveLength(1);

        await runAnimationFrame(160);
        await animation;

        expect(mocks.setWindowBounds).toHaveBeenLastCalledWith({
            width: 480,
            height: 800,
            x: 820,
            y: 100
        });
    });

    it('switches immediately when reduced motion is enabled', async () => {
        usePreferencesStore.setState({ reducedMotionAndBlur: true });

        await animateWindowBounds(
            { width: 1200, height: 800, x: 100, y: 100 },
            { width: 480, height: 800, x: 820, y: 100 }
        );

        expect(animationFrames).toHaveLength(0);
        expect(mocks.setWindowBounds).toHaveBeenCalledOnce();
        expect(mocks.setWindowBounds).toHaveBeenCalledWith({
            width: 480,
            height: 800,
            x: 820,
            y: 100
        });
    });
});
