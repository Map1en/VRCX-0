import { describe, expect, it } from 'vitest';

import { PlatformUnavailableError, normalizePlatformError } from './errors.js';

describe('tauri errors', () => {
    it('keeps Error instances when no extra fallback context is needed', () => {
        const error = new Error('Backend command failed');

        expect(normalizePlatformError(error, 'Backend command failed')).toBe(error);
        expect(normalizePlatformError(error)).toBe(error);
    });

    it('wraps Error instances with fallback context once', () => {
        const error = new TypeError('boom');
        const normalized = normalizePlatformError(error, 'SQLite query failed');

        expect(normalized).not.toBe(error);
        expect(normalized.name).toBe('TypeError');
        expect(normalized.message).toBe('SQLite query failed: boom');
        expect(normalized.cause).toBe(error);

        expect(normalizePlatformError(normalized, 'SQLite query failed')).toBe(normalized);
    });

    it('normalizes non-Error values into useful messages', () => {
        expect(normalizePlatformError(null, 'Backend command failed').message).toBe('Backend command failed');
        expect(normalizePlatformError('denied', 'Backend command failed').message).toBe('Backend command failed: denied');
        expect(normalizePlatformError({ code: 'E_FAIL' }, 'Backend command failed').message).toBe('Backend command failed: {"code":"E_FAIL"}');
    });

    it('uses a specific name for unavailable platform APIs', () => {
        const error = new PlatformUnavailableError();

        expect(error.name).toBe('PlatformUnavailableError');
        expect(error.message).toBe('Tauri platform APIs are unavailable in this runtime');
    });
});
