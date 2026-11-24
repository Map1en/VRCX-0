import { describe, expect, it } from 'vitest';

import { safeJsonParse } from '@/shared/utils/json';

import { asString, safeJsonStringify } from './baseRepository';

describe('asString', () => {
    it('falls back to the caller-supplied default when a preference was never stored, instead of showing "undefined" in the UI', () => {
        expect(asString(undefined, 'default-value')).toBe('default-value');
        expect(asString(null, 'default-value')).toBe('default-value');
    });

    it('preserves a stored value of "0" or "false" rather than treating it as missing', () => {
        expect(asString(0, 'fallback')).toBe('0');
        expect(asString(false, 'fallback')).toBe('false');
        expect(asString('', 'fallback')).toBe('');
    });
});

describe('safeJsonStringify', () => {
    it('serializes a preference object for persistence', () => {
        expect(safeJsonStringify({ enabled: true, count: 3 })).toBe(
            '{"enabled":true,"count":3}'
        );
    });

    it('never throws when asked to persist a value JSON cannot represent, so a save action can never crash the app', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        expect(safeJsonStringify(circular)).toBe('null');
        expect(safeJsonStringify(10n)).toBe('null');
    });

    it('round-trips through safeJsonParse without losing data', () => {
        const original = { providerList: ['a', 'b'], selected: 'a' };
        expect(safeJsonParse(safeJsonStringify(original))).toEqual(original);
    });
});
