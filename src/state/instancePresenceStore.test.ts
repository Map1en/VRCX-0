import { beforeEach, describe, expect, it } from 'vitest';

import type { InstancePresenceFactInput } from '@/domain/presence/instancePresence';

import { useInstancePresenceStore } from './instancePresenceStore';

const INSTANCE_PRESENCE_CAPACITY = 256;

function presenceInput(
    overrides: Partial<InstancePresenceFactInput> = {}
): InstancePresenceFactInput {
    return {
        endpoint: 'api',
        location: 'wrld_test:12345',
        source: 'seed',
        ownerUserId: 'usr_owner',
        worldName: 'Test World',
        instanceName: '12345',
        receivedAt: '2026-01-01T00:00:00.000Z',
        ...overrides
    };
}

function manyLocations(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `wrld_evict:${index}`);
}

describe('instancePresenceStore', () => {
    beforeEach(() => {
        useInstancePresenceStore.getState().resetInstancePresence();
    });

    it('stores a presence fact, bumps version, and tracks the key in order', () => {
        const store = useInstancePresenceStore.getState();

        store.upsertInstancePresence(presenceInput());

        const state = useInstancePresenceStore.getState();
        expect(state.presenceByKey['api::wrld_test:12345']).toMatchObject({
            endpoint: 'api',
            worldId: 'wrld_test',
            instanceId: '12345'
        });
        expect(state.version).toBe(1);
        expect(state.order).toEqual(['api::wrld_test:12345']);
    });

    it('skips the update when the incoming fact is unchanged', () => {
        const store = useInstancePresenceStore.getState();
        const input = presenceInput();

        store.upsertInstancePresence(input);
        store.upsertInstancePresence(presenceInput());

        const state = useInstancePresenceStore.getState();
        expect(state.version).toBe(1);
        expect(state.order).toEqual(['api::wrld_test:12345']);
    });

    it('evicts the oldest presence entries once capacity is exceeded', () => {
        const store = useInstancePresenceStore.getState();
        const locations = manyLocations(INSTANCE_PRESENCE_CAPACITY + 1);

        for (const location of locations) {
            store.upsertInstancePresence(presenceInput({ location }));
        }

        const state = useInstancePresenceStore.getState();
        expect(state.order.length).toBe(INSTANCE_PRESENCE_CAPACITY);
        expect(Object.keys(state.presenceByKey).length).toBe(
            INSTANCE_PRESENCE_CAPACITY
        );
        expect(state.presenceByKey['api::wrld_evict:0']).toBeUndefined();
        expect(
            state.presenceByKey[`api::wrld_evict:${INSTANCE_PRESENCE_CAPACITY}`]
        ).toBeDefined();
        expect(state.order).not.toContain('api::wrld_evict:0');
        expect(state.order).toContain(
            `api::wrld_evict:${INSTANCE_PRESENCE_CAPACITY}`
        );
    });

    it('resets presence state back to empty', () => {
        const store = useInstancePresenceStore.getState();
        store.upsertInstancePresence(presenceInput());

        store.resetInstancePresence();

        const state = useInstancePresenceStore.getState();
        expect(state.presenceByKey).toEqual({});
        expect(state.order).toEqual([]);
        expect(state.version).toBe(0);
    });

    it('no longer exposes the removed locationsByEndpoint field', () => {
        const state = useInstancePresenceStore.getState() as unknown as Record<
            string,
            unknown
        >;

        expect('locationsByEndpoint' in state).toBe(false);
    });
});
