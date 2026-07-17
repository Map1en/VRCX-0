import { beforeEach, describe, expect, it } from 'vitest';

import { useUserFactsStore } from './userFactsStore';

function rustUser(overrides: Record<string, unknown> = {}) {
    return {
        id: 'usr_test',
        endpoint: 'api',
        displayName: 'Mirror User',
        stateBucket: 'online',
        location: 'wrld_live:123',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides
    };
}

function manyUsers(count: number) {
    return Array.from({ length: count }, (_, index) =>
        rustUser({ id: `usr_${index}`, endpoint: 'api' })
    );
}

describe('userFactsStore', () => {
    beforeEach(() => {
        useUserFactsStore.getState().resetUserFacts();
    });

    it('mirrors Rust user objects verbatim, bumps version, and tracks ids by endpoint', () => {
        const store = useUserFactsStore.getState();
        const user = rustUser();

        store.replaceUserFacts([user]);

        const state = useUserFactsStore.getState();
        expect(state.usersByKey['api::usr_test']).toBe(user);
        expect(state.version).toBe(1);
        expect(state.userIdsByEndpoint.api).toEqual(new Set(['usr_test']));

        const replacement = rustUser({ displayName: 'Mirror User v2' });
        store.replaceUserFacts([replacement]);

        const nextState = useUserFactsStore.getState();
        expect(nextState.usersByKey['api::usr_test']).toBe(replacement);
        expect(nextState.version).toBe(2);
    });

    it('ignores empty arrays and skips entries without an id', () => {
        const store = useUserFactsStore.getState();

        store.replaceUserFacts([]);
        expect(useUserFactsStore.getState().version).toBe(0);
        expect(useUserFactsStore.getState().usersByKey).toEqual({});

        const facts: unknown[] = [
            rustUser(),
            { endpoint: 'api', displayName: 'No Id' }
        ];
        store.replaceUserFacts(
            facts as Parameters<typeof store.replaceUserFacts>[0]
        );

        const state = useUserFactsStore.getState();
        expect(state.version).toBe(1);
        expect(Object.keys(state.usersByKey)).toEqual(['api::usr_test']);
        expect(state.userIdsByEndpoint.api).toEqual(new Set(['usr_test']));
    });

    it('resets user facts on auth boundary changes', () => {
        useUserFactsStore.getState().replaceUserFacts([rustUser()]);

        useUserFactsStore.getState().resetUserFacts();

        expect(useUserFactsStore.getState().usersByKey).toEqual({});
        expect(useUserFactsStore.getState().userIdsByEndpoint).toEqual({});
        expect(useUserFactsStore.getState().order).toEqual([]);
    });

    it('evicts the oldest non-friend user once the non-friend capacity is exceeded', () => {
        const store = useUserFactsStore.getState();

        store.replaceUserFacts(manyUsers(1001));

        const state = useUserFactsStore.getState();
        expect(state.order.length).toBe(1000);
        expect(Object.keys(state.usersByKey).length).toBe(1000);
        expect(state.usersByKey['api::usr_0']).toBeUndefined();
        expect(state.usersByKey['api::usr_1000']).toBeDefined();
    });

    it('pins friends so they are never evicted even past capacity', () => {
        const store = useUserFactsStore.getState();
        const friend = rustUser({ id: 'usr_friend', isFriend: true });
        store.replaceUserFacts([friend]);

        store.replaceUserFacts(manyUsers(1001));

        const state = useUserFactsStore.getState();
        expect(state.usersByKey['api::usr_friend']).toBeDefined();
        expect(state.order).not.toContain('api::usr_friend');
    });

    it('removes evicted user ids from userIdsByEndpoint', () => {
        const store = useUserFactsStore.getState();

        store.replaceUserFacts(manyUsers(1001));

        const state = useUserFactsStore.getState();
        expect(state.userIdsByEndpoint.api.has('usr_0')).toBe(false);
        expect(state.userIdsByEndpoint.api.has('usr_1000')).toBe(true);
        expect(state.userIdsByEndpoint.api.size).toBe(1000);
    });
});
