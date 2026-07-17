import { describe, expect, it } from 'vitest';

import { evictOverflow } from './storeEviction';

describe('evictOverflow', () => {
    it('returns an empty array and leaves the order untouched when under capacity', () => {
        const order = ['a', 'b', 'c'];

        const evicted = evictOverflow(order, 5);

        expect(evicted).toEqual([]);
        expect(order).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty array and leaves the order untouched when exactly at capacity', () => {
        const order = ['a', 'b', 'c'];

        const evicted = evictOverflow(order, 3);

        expect(evicted).toEqual([]);
        expect(order).toEqual(['a', 'b', 'c']);
    });

    it('splices out the oldest overflowing entries and returns them in original order', () => {
        const order = ['a', 'b', 'c', 'd', 'e'];

        const evicted = evictOverflow(order, 3);

        expect(evicted).toEqual(['a', 'b']);
        expect(order).toEqual(['c', 'd', 'e']);
        expect(order.length).toBe(3);
    });

    it('handles a capacity of 0 by evicting everything', () => {
        const order = ['a', 'b', 'c'];

        const evicted = evictOverflow(order, 0);

        expect(evicted).toEqual(['a', 'b', 'c']);
        expect(order).toEqual([]);
    });

    it('handles a capacity of 1 by keeping only the newest entry', () => {
        const order = ['a', 'b', 'c'];

        const evicted = evictOverflow(order, 1);

        expect(evicted).toEqual(['a', 'b']);
        expect(order).toEqual(['c']);
    });

    it('returns an empty array for an already empty order regardless of capacity', () => {
        const order: string[] = [];

        const evicted = evictOverflow(order, 0);

        expect(evicted).toEqual([]);
        expect(order).toEqual([]);
    });
});
