// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const transform = vi.hoisted(() => ({
    resetTransform: vi.fn(),
    rotateClockwise: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn()
}));

vi.mock('./useFullscreenImageTransform', () => ({
    useFullscreenImageTransform: () => ({
        viewerRef: { current: null },
        transformStyle: {},
        handleDoubleClick: vi.fn(),
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
        handleWheel: vi.fn(),
        rotateCounterClockwise: vi.fn(),
        ...transform
    })
}));

import { FullscreenImageViewer } from './FullscreenImageViewer';

afterEach(() => {
    cleanup();
    Object.values(transform).forEach((spy) => spy.mockReset());
});

function press(init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init
    });
    act(() => {
        window.dispatchEvent(event);
    });
    return event;
}

describe('FullscreenImageViewer keyboard shortcuts', () => {
    it('handles bare zoom, rotate and reset keys', () => {
        render(
            <FullscreenImageViewer
                open
                url="https://example.test/image.png"
                onClose={() => {}}
            />
        );

        expect(press({ key: '=' }).defaultPrevented).toBe(true);
        press({ key: '+', shiftKey: true });
        press({ key: '-' });
        press({ key: 'r' });
        press({ key: '0' });

        expect(transform.zoomIn).toHaveBeenCalledTimes(2);
        expect(transform.zoomOut).toHaveBeenCalledOnce();
        expect(transform.rotateClockwise).toHaveBeenCalledOnce();
        expect(transform.resetTransform).toHaveBeenCalledOnce();
    });

    it('leaves Ctrl, Meta and Alt zoom and reset combinations and IME input to the browser', () => {
        render(
            <FullscreenImageViewer
                open
                url="https://example.test/image.png"
                onClose={() => {}}
            />
        );

        const ctrlZoom = press({ key: '=', ctrlKey: true });
        const ctrlZoomOut = press({ key: '-', ctrlKey: true });
        const metaReset = press({ key: '0', metaKey: true });
        const altZoom = press({ key: '=', altKey: true });
        press({ key: '=', isComposing: true });

        expect(ctrlZoom.defaultPrevented).toBe(false);
        expect(ctrlZoomOut.defaultPrevented).toBe(false);
        expect(metaReset.defaultPrevented).toBe(false);
        expect(altZoom.defaultPrevented).toBe(false);
        expect(transform.zoomIn).not.toHaveBeenCalled();
        expect(transform.zoomOut).not.toHaveBeenCalled();
        expect(transform.resetTransform).not.toHaveBeenCalled();
    });

    it('rotates on Ctrl+R and keeps the WebView reload accelerator from firing', () => {
        render(
            <FullscreenImageViewer
                open
                url="https://example.test/image.png"
                onClose={() => {}}
            />
        );

        const ctrlRotate = press({ key: 'r', ctrlKey: true });

        expect(ctrlRotate.defaultPrevented).toBe(true);
        expect(transform.rotateClockwise).toHaveBeenCalledOnce();
    });

    it('steps through images with the arrow keys only where a neighbour exists', () => {
        const onNavigatePrev = vi.fn();
        const onNavigateNext = vi.fn();
        render(
            <FullscreenImageViewer
                open
                url="https://example.test/image.png"
                navigation={{
                    canNavigatePrev: false,
                    canNavigateNext: true,
                    onNavigatePrev,
                    onNavigateNext
                }}
                onClose={() => {}}
            />
        );

        const left = press({ key: 'ArrowLeft' });
        const right = press({ key: 'ArrowRight' });
        press({ key: 'ArrowRight', shiftKey: true });

        expect(left.defaultPrevented).toBe(false);
        expect(right.defaultPrevented).toBe(true);
        expect(onNavigatePrev).not.toHaveBeenCalled();
        expect(onNavigateNext).toHaveBeenCalledOnce();
    });

    it('leaves the arrow keys alone without navigation', () => {
        render(
            <FullscreenImageViewer
                open
                url="https://example.test/image.png"
                onClose={() => {}}
            />
        );

        expect(press({ key: 'ArrowRight' }).defaultPrevented).toBe(false);
    });
});
