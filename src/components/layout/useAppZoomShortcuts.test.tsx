// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    toastAdd: vi.fn<(options: AppToastOptions) => string>(() => 'toast'),
    queueZoom: vi.fn<(value: number) => number>((value) => value),
    stepZoom: vi.fn<(delta: number) => number>((delta) => 100 + delta)
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd, close: vi.fn() }
}));

vi.mock('@/services/zoomPreferenceService', () => ({
    queueZoomLevelPreference: mocks.queueZoom,
    stepQueuedZoomLevelPreference: mocks.stepZoom
}));

import { dispatchGlobalShortcut } from '@/components/keyboard/shortcutDispatcher';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useAppZoomShortcuts } from './useAppZoomShortcuts';

type ToastActionClickEvent = Parameters<
    NonNullable<NonNullable<AppToastOptions['actionProps']>['onClick']>
>[0];

function dispatchKeyboardShortcut(event: KeyboardEvent) {
    dispatchGlobalShortcut(event, false);
}

function pressKey(init: KeyboardEventInit, target: EventTarget = window) {
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        ...init
    });
    act(() => {
        target.dispatchEvent(event);
    });
    return event;
}

function scroll(init: WheelEventInit) {
    const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ...init
    });
    act(() => {
        window.dispatchEvent(event);
    });
    return event;
}

function lastToast(): AppToastOptions {
    const options = mocks.toastAdd.mock.lastCall?.[0];
    if (!options) {
        throw new Error('expected a toast');
    }
    return options;
}

describe('useAppZoomShortcuts', () => {
    beforeEach(() => {
        mocks.toastAdd.mockClear();
        mocks.queueZoom.mockClear();
        mocks.stepZoom.mockClear();
        useRuntimeStore.getState().resetRuntimeState();
        usePreferencesStore.setState({ ctrlWheelZoom: false });
        window.addEventListener('keydown', dispatchKeyboardShortcut);
    });

    afterEach(() => {
        window.removeEventListener('keydown', dispatchKeyboardShortcut);
        cleanup();
    });

    it('steps and resets the app zoom with Ctrl shortcuts and reports the level', () => {
        renderHook(() => useAppZoomShortcuts());

        const zoomIn = pressKey({ key: '=' });
        const zoomInShifted = pressKey({ key: '+', shiftKey: true });
        const zoomOut = pressKey({ key: '-' });

        expect(zoomIn.defaultPrevented).toBe(true);
        expect(zoomInShifted.defaultPrevented).toBe(true);
        expect(zoomOut.defaultPrevented).toBe(true);
        expect(mocks.stepZoom.mock.calls.map(([delta]) => delta)).toEqual([
            5, 5, -5
        ]);
        expect(lastToast()).toMatchObject({
            id: 'app-zoom-level',
            position: 'bottom-center'
        });
        expect(mocks.toastAdd).toHaveBeenCalledTimes(3);

        lastToast().actionProps?.onClick?.(
            new MouseEvent('click') as unknown as ToastActionClickEvent
        );
        expect(mocks.queueZoom).toHaveBeenLastCalledWith(
            100,
            expect.anything()
        );

        const reset = pressKey({ key: '0' });
        expect(reset.defaultPrevented).toBe(true);
        expect(mocks.queueZoom).toHaveBeenCalledTimes(2);
        expect(lastToast().id).toBe('app-zoom-level');
        expect(lastToast().actionProps).toBeUndefined();
    });

    it('handles zoom shortcuts while editing text', () => {
        renderHook(() => useAppZoomShortcuts());
        const input = document.createElement('input');
        document.body.append(input);

        const event = pressKey({ key: '-' }, input);

        expect(event.defaultPrevented).toBe(true);
        expect(mocks.stepZoom).toHaveBeenCalledWith(-5, expect.anything());
        input.remove();
    });

    it('ignores Ctrl+wheel until the preference is enabled', () => {
        renderHook(() => useAppZoomShortcuts());

        const event = scroll({ ctrlKey: true, deltaY: -100 });

        expect(event.defaultPrevented).toBe(false);
        expect(mocks.stepZoom).not.toHaveBeenCalled();
    });

    it('zooms one step per wheel notch and accumulates small pinch deltas', () => {
        usePreferencesStore.setState({ ctrlWheelZoom: true });
        renderHook(() => useAppZoomShortcuts());

        const notch = scroll({ ctrlKey: true, deltaY: -100 });
        expect(notch.defaultPrevented).toBe(true);
        expect(mocks.stepZoom).toHaveBeenLastCalledWith(5, expect.anything());

        mocks.stepZoom.mockClear();
        for (let index = 0; index < 4; index += 1) {
            scroll({ ctrlKey: true, deltaY: 10 });
        }
        expect(mocks.stepZoom).not.toHaveBeenCalled();
        scroll({ ctrlKey: true, deltaY: 10 });
        expect(mocks.stepZoom).toHaveBeenCalledOnce();
        expect(mocks.stepZoom).toHaveBeenLastCalledWith(-5, expect.anything());
    });

    it('leaves plain scrolling and wheel gestures handled by other components alone', () => {
        usePreferencesStore.setState({ ctrlWheelZoom: true });
        renderHook(() => useAppZoomShortcuts());

        const plain = scroll({ deltaY: -100 });
        const handled = new WheelEvent('wheel', {
            cancelable: true,
            ctrlKey: true,
            deltaY: -100
        });
        handled.preventDefault();
        act(() => {
            window.dispatchEvent(handled);
        });

        expect(plain.defaultPrevented).toBe(false);
        expect(mocks.stepZoom).not.toHaveBeenCalled();
    });
});
