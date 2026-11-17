import { beforeEach, describe, expect, it } from 'vitest';

import { useFriendLocationTimeStore } from './friendLocationTimeStore';

describe('friendLocationTimeStore', () => {
    beforeEach(() => {
        useFriendLocationTimeStore.getState().reset();
    });

    it('normalizes and atomically replaces a complete snapshot', () => {
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: ' usr_first ',
                location: ' wrld_first:1 ',
                source: 'gameLog',
                sinceMs: 1_700_000_000_000
            },
            {
                userId: 'usr_second',
                location: 'private',
                source: 'realtime',
                sinceMs: null
            }
        ]);

        expect(useFriendLocationTimeStore.getState().byUserId).toEqual({
            usr_first: {
                location: 'wrld_first:1',
                source: 'gameLog',
                sinceMs: 1_700_000_000_000
            },
            usr_second: {
                location: 'private',
                source: 'realtime',
                sinceMs: null
            }
        });

        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_second',
                location: 'wrld_second:2',
                source: 'realtime',
                sinceMs: 1_700_000_100_000
            }
        ]);

        expect(useFriendLocationTimeStore.getState().byUserId).toEqual({
            usr_second: {
                location: 'wrld_second:2',
                source: 'realtime',
                sinceMs: 1_700_000_100_000
            }
        });
    });

    it('keeps unchanged entries and the map itself across repeated snapshots', () => {
        const first = {
            userId: 'usr_first',
            location: 'wrld_first:1',
            source: 'realtime' as const,
            sinceMs: 1_700_000_000_000
        };
        const second = {
            userId: 'usr_second',
            location: 'wrld_second:2',
            source: 'realtime' as const,
            sinceMs: 1_700_000_100_000
        };
        const store = useFriendLocationTimeStore.getState();
        store.replaceSnapshot([first, second]);
        const initial = useFriendLocationTimeStore.getState().byUserId;

        store.replaceSnapshot([{ ...first }, { ...second }]);
        expect(useFriendLocationTimeStore.getState().byUserId).toBe(initial);

        store.replaceSnapshot([
            { ...first },
            { ...second, location: 'wrld_third:3' }
        ]);
        const updated = useFriendLocationTimeStore.getState().byUserId;
        expect(updated).not.toBe(initial);
        expect(updated.usr_first).toBe(initial.usr_first);
        expect(updated.usr_second).toEqual({
            location: 'wrld_third:3',
            source: 'realtime',
            sinceMs: 1_700_000_100_000
        });

        store.replaceSnapshot([
            { ...first },
            { ...second, userId: 'usr_third' }
        ]);
        const swapped = useFriendLocationTimeStore.getState().byUserId;
        expect(swapped).not.toBe(updated);
        expect(swapped.usr_second).toBeUndefined();
        expect(swapped.usr_third).toEqual({
            location: 'wrld_second:2',
            source: 'realtime',
            sinceMs: 1_700_000_100_000
        });

        store.replaceSnapshot([{ ...first }]);
        expect(useFriendLocationTimeStore.getState().byUserId).toEqual({
            usr_first: initial.usr_first
        });
    });

    it('treats an empty snapshot as an explicit clear', () => {
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_friend',
                location: 'wrld_test:1',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            }
        ]);

        useFriendLocationTimeStore.getState().replaceSnapshot([]);

        expect(useFriendLocationTimeStore.getState().byUserId).toEqual({});
    });
});
