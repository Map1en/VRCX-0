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
