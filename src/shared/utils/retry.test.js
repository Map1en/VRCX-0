import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeWithBackoff } from './retry.js';

describe('executeWithBackoff', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the first successful attempt without scheduling retries', async () => {
        vi.useFakeTimers();
        const fn = vi.fn().mockResolvedValue('ok');

        await expect(executeWithBackoff(fn, { baseDelay: 100 })).resolves.toBe('ok');

        expect(fn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retries with exponential delays before returning a later success', async () => {
        vi.useFakeTimers();
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('first'))
            .mockRejectedValueOnce(new Error('second'))
            .mockResolvedValue('ok');

        const result = executeWithBackoff(fn, {
            maxRetries: 2,
            baseDelay: 100
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(fn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(99);
        expect(fn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(fn).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(199);
        expect(fn).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('stops immediately when shouldRetry rejects the error', async () => {
        vi.useFakeTimers();
        const error = new Error('fatal');
        const shouldRetry = vi.fn().mockReturnValue(false);
        const fn = vi.fn().mockRejectedValue(error);

        await expect(executeWithBackoff(fn, {
            maxRetries: 3,
            baseDelay: 100,
            shouldRetry
        })).rejects.toBe(error);

        expect(fn).toHaveBeenCalledTimes(1);
        expect(shouldRetry).toHaveBeenCalledWith(error);
        expect(vi.getTimerCount()).toBe(0);
    });
});
