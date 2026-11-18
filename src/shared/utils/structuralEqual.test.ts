import { describe, expect, it } from 'vitest';

import { structuralEqual } from './structuralEqual';

describe('structuralEqual', () => {
    it('treats rebuilt plain objects and arrays with the same values as equal', () => {
        expect(
            structuralEqual(
                { id: 'a', users: [{ id: 'usr_1', name: 'One' }], count: 2 },
                { id: 'a', users: [{ id: 'usr_1', name: 'One' }], count: 2 }
            )
        ).toBe(true);
    });

    it('detects changed, missing and extra values at any depth', () => {
        const base = { id: 'a', users: [{ id: 'usr_1' }] };
        expect(
            structuralEqual(base, { id: 'a', users: [{ id: 'usr_2' }] })
        ).toBe(false);
        expect(structuralEqual(base, { id: 'a' })).toBe(false);
        expect(structuralEqual(base, { ...base, extra: undefined })).toBe(
            false
        );
        expect(structuralEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it('compares non-plain objects by identity', () => {
        const date = new Date(0);
        expect(structuralEqual(date, date)).toBe(true);
        expect(structuralEqual(new Date(0), new Date(0))).toBe(false);
        expect(structuralEqual(new Set([1]), new Set([1]))).toBe(false);
    });
});
