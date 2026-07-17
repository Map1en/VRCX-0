import { beforeEach, describe, expect, it } from 'vitest';

import type { LocationHintInput } from './locationHintStore';
import { locationHintKey, useLocationHintStore } from './locationHintStore';

const LOCATION_HINT_CAPACITY = 512;

function hintInput(
    overrides: Partial<LocationHintInput> = {}
): LocationHintInput {
    return {
        endpoint: 'api',
        location: 'wrld_test:12345',
        worldId: 'wrld_test',
        worldName: 'Test World',
        instanceName: '12345',
        region: 'US West',
        isClosed: false,
        ageGate: false,
        ...overrides
    };
}

function manyLocations(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `wrld_evict:${index}`);
}

describe('locationHintStore', () => {
    beforeEach(() => {
        useLocationHintStore.getState().resetLocationHints();
    });

    it('stores a location hint, bumps version, and tracks the key in order', () => {
        const store = useLocationHintStore.getState();
        const key = locationHintKey('api', 'wrld_test:12345');

        store.upsertLocationHint(hintInput());

        const state = useLocationHintStore.getState();
        expect(state.hintsByKey[key]).toMatchObject({
            endpoint: 'api',
            worldId: 'wrld_test',
            worldName: 'Test World',
            instanceName: '12345'
        });
        expect(state.version).toBe(1);
        expect(state.order).toEqual([key]);
    });

    it('skips the update when only updatedAt would change', () => {
        const store = useLocationHintStore.getState();
        const key = locationHintKey('api', 'wrld_test:12345');

        store.upsertLocationHint(hintInput());
        store.upsertLocationHint(hintInput());

        const state = useLocationHintStore.getState();
        expect(state.version).toBe(1);
        expect(state.order).toEqual([key]);
    });

    it('evicts the oldest location hints once capacity is exceeded', () => {
        const store = useLocationHintStore.getState();
        const locations = manyLocations(LOCATION_HINT_CAPACITY + 1);
        const oldestKey = locationHintKey('api', locations[0]);
        const newestKey = locationHintKey(
            'api',
            locations[LOCATION_HINT_CAPACITY]
        );

        for (const location of locations) {
            store.upsertLocationHint(hintInput({ location, worldId: '' }));
        }

        const state = useLocationHintStore.getState();
        expect(state.order.length).toBe(LOCATION_HINT_CAPACITY);
        expect(Object.keys(state.hintsByKey).length).toBe(
            LOCATION_HINT_CAPACITY
        );
        expect(state.hintsByKey[oldestKey]).toBeUndefined();
        expect(state.hintsByKey[newestKey]).toBeDefined();
        expect(state.order).not.toContain(oldestKey);
        expect(state.order).toContain(newestKey);
    });

    it('resets location hint state back to empty', () => {
        const store = useLocationHintStore.getState();
        store.upsertLocationHint(hintInput());

        store.resetLocationHints();

        const state = useLocationHintStore.getState();
        expect(state.hintsByKey).toEqual({});
        expect(state.order).toEqual([]);
        expect(state.version).toBe(0);
    });
});
