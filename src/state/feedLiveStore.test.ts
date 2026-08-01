import { beforeEach, describe, expect, it, vi } from 'vitest';

import { feedEntryCorrectionId, useFeedLiveStore } from './feedLiveStore';

const goldenFeedEntryCorrectionIds = [
    {
        input: {
            id: 'feed-entry-1',
            type: 'GPS',
            rowId: '10',
            sourceRank: '2'
        },
        expected: 'id:feed-entry-1'
    },
    {
        input: {
            type: 'GPS',
            rowId: '10',
            sourceRank: '2'
        },
        expected: 'row:GPS:2:10'
    },
    {
        input: {
            type: 'Online',
            row_id: '11',
            source_rank: '3'
        },
        expected: 'row:Online:3:11'
    },
    {
        input: {
            type: 'invite',
            created_at: '2026-06-21T00:00:00.000Z',
            userId: 'usr_sender',
            details: {
                location: 'wrld_world:123'
            },
            message: 'Join me'
        },
        expected:
            'invite:2026-06-21T00:00:00.000Z:usr_sender:wrld_world:123:Join me'
    }
];

describe('feedEntryCorrectionId', () => {
    it('matches the Rust correction id golden vectors', () => {
        for (const vector of goldenFeedEntryCorrectionIds) {
            expect(feedEntryCorrectionId(vector.input)).toBe(vector.expected);
        }
    });
});

describe('feedLiveStore pushEntries', () => {
    beforeEach(() => {
        useFeedLiveStore.getState().resetFeedLive();
    });

    it('assigns consecutive sequences matching pushEntry', () => {
        useFeedLiveStore.getState().pushEntry({ id: 'a' });
        useFeedLiveStore.getState().pushEntries([{ id: 'b' }, { id: 'c' }], {
            ownerUserId: 'usr_owner'
        });
        const state = useFeedLiveStore.getState();
        expect(state.entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
        expect(state.entries.map((entry) => entry.entry.id)).toEqual([
            'a',
            'b',
            'c'
        ]);
        expect(state.entries[2].ownerUserId).toBe('usr_owner');
        expect(state.entries[2].entry.ownerUserId).toBe('usr_owner');
        expect(state.version).toBe(3);
    });

    it('skips non-record entries and does not bump on empty input', () => {
        useFeedLiveStore.getState().pushEntries([null, undefined, { id: 'a' }]);
        expect(useFeedLiveStore.getState().version).toBe(1);
        expect(useFeedLiveStore.getState().entries).toHaveLength(1);
        useFeedLiveStore.getState().pushEntries([]);
        useFeedLiveStore.getState().pushEntries(null);
        expect(useFeedLiveStore.getState().version).toBe(1);
    });

    it('keeps at most the last 100 entries', () => {
        const entries = Array.from({ length: 120 }, (_, index) => ({
            id: `entry-${index}`
        }));
        useFeedLiveStore.getState().pushEntries(entries);
        const state = useFeedLiveStore.getState();
        expect(state.entries).toHaveLength(100);
        expect(state.version).toBe(120);
        expect(state.entries[0].sequence).toBe(21);
        expect(state.entries[0].entry.id).toBe('entry-20');
        expect(state.entries[99].sequence).toBe(120);
    });

    it('notifies subscribers once per batch', () => {
        const listener = vi.fn();
        const unsubscribe = useFeedLiveStore.subscribe(listener);
        useFeedLiveStore
            .getState()
            .pushEntries([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
        unsubscribe();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
