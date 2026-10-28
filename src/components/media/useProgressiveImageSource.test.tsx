// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    clearDecodedImagesForTest,
    isImageDecoded,
    preloadImages
} from './imageDecodeCache';
import { useProgressiveImageSource } from './useProgressiveImageSource';

type Deferred = { resolve: () => void; reject: () => void };

const pending = new Map<string, Deferred>();
const decodeCalls: string[] = [];

function settle(src: string, ok = true) {
    const deferred = pending.get(src);
    if (!deferred) {
        throw new Error(`No pending decode for ${src}`);
    }
    if (ok) {
        deferred.resolve();
    } else {
        deferred.reject();
    }
}

beforeEach(() => {
    pending.clear();
    decodeCalls.length = 0;
    clearDecodedImagesForTest();
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        configurable: true,
        value(this: HTMLImageElement) {
            const src = this.getAttribute('src') || '';
            decodeCalls.push(src);
            return new Promise<void>((resolve, reject) => {
                pending.set(src, {
                    resolve,
                    reject: () => reject(new Error('decode'))
                });
            });
        }
    });
});

afterEach(() => {
    Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
});

describe('preloadImages', () => {
    it('decodes each neighbor once and reuses the decoded result', async () => {
        preloadImages(['prev.png', '', 'next.png']);
        preloadImages(['next.png']);

        expect(decodeCalls).toEqual(['prev.png', 'next.png']);
        await act(async () => {
            settle('next.png');
        });
        expect(isImageDecoded('next.png')).toBe(true);
        expect(isImageDecoded('prev.png')).toBe(false);
    });
});

describe('useProgressiveImageSource', () => {
    it('keeps the previous image until the next one is decoded', async () => {
        const { result, rerender } = renderHook(
            ({ src }) => useProgressiveImageSource(src),
            { initialProps: { src: 'a.png' } }
        );
        await act(async () => {
            settle('a.png');
        });
        expect(result.current.shownSrc).toBe('a.png');

        rerender({ src: 'b.png' });
        expect(result.current.shownSrc).toBe('a.png');
        expect(result.current.status).toBe('loading');
        expect(result.current.isInterim).toBe(true);

        await act(async () => {
            settle('b.png');
        });
        expect(result.current.shownSrc).toBe('b.png');
        expect(result.current.isInterim).toBe(false);
    });

    it('switches to a preloaded image immediately', async () => {
        preloadImages(['next.png']);
        await act(async () => {
            settle('next.png');
        });

        const { result } = renderHook(() =>
            useProgressiveImageSource('next.png')
        );

        expect(result.current.shownSrc).toBe('next.png');
        expect(result.current.status).toBe('ready');
    });

    it('shows the thumbnail first and hard-switches to the full image', async () => {
        const { result } = renderHook(() =>
            useProgressiveImageSource('full.png', 'thumb.png')
        );
        expect(result.current.shownSrc).toBe('');

        await act(async () => {
            settle('thumb.png');
        });
        expect(result.current.shownSrc).toBe('thumb.png');

        await act(async () => {
            settle('full.png');
        });
        expect(result.current.shownSrc).toBe('full.png');
    });

    it('ignores a thumbnail that decodes after the full image', async () => {
        const { result } = renderHook(() =>
            useProgressiveImageSource('full.png', 'thumb.png')
        );

        await act(async () => {
            settle('full.png');
            settle('thumb.png');
        });
        expect(result.current.shownSrc).toBe('full.png');
    });

    it('reports a failed full image', async () => {
        const { result } = renderHook(() =>
            useProgressiveImageSource('broken.png')
        );

        await act(async () => {
            settle('broken.png', false);
        });
        expect(result.current.status).toBe('error');
        expect(result.current.shownSrc).toBe('');
    });
});
