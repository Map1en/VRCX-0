import { describe, expect, it } from 'vitest';

import { normalizeBoolean, normalizeNumber } from './coerce';

describe('coerce utils', () => {
    it('coerces finite numbers and falls back to zero', () => {
        expect(normalizeNumber(12)).toBe(12);
        expect(normalizeNumber('3.5')).toBe(3.5);
        expect(normalizeNumber('not a number')).toBe(0);
        expect(normalizeNumber(Infinity)).toBe(0);
        expect(normalizeNumber(null)).toBe(0);
    });

    it('treats truthy boolean-like values as true', () => {
        expect(normalizeBoolean(true)).toBe(true);
        expect(normalizeBoolean('true')).toBe(true);
        expect(normalizeBoolean(1)).toBe(true);
        expect(normalizeBoolean('1')).toBe(true);
        expect(normalizeBoolean(false)).toBe(false);
        expect(normalizeBoolean('false')).toBe(false);
        expect(normalizeBoolean(0)).toBe(false);
        expect(normalizeBoolean(undefined)).toBe(false);
    });
});
