import { describe, expect, it } from 'vitest';

import type { PresenceView } from '@/domain/friends/presence';
import { parseLocation } from '@/shared/utils/location';

import { aggregateHotWorlds, groupFriendsByWorld } from './searchHotWorlds';

function world(id: string) {
    return { id, name: id, thumbnailImageUrl: `https://example.test/${id}` };
}

describe('aggregateHotWorlds', () => {
    it('sums people and rooms per world and ranks by people', () => {
        const worlds = aggregateHotWorlds([
            { world: world('wrld_a'), n_users: 32 },
            { world: world('wrld_a'), n_users: 20 },
            { world: world('wrld_b'), userCount: 80 },
            { world: world('wrld_c'), userCount: 10 },
            { n_users: 5 }
        ]);

        expect(
            worlds.map((entry) => [
                entry.world.id,
                entry.userCount,
                entry.instanceCount
            ])
        ).toEqual([
            ['wrld_b', 80, 1],
            ['wrld_a', 52, 2],
            ['wrld_c', 10, 1]
        ]);
    });
});

function online(
    location: string,
    travelingTo = ''
): { $presence: PresenceView } {
    return {
        $presence: {
            kind: 'online',
            place: {
                location: parseLocation(location),
                travelingTo: travelingTo ? parseLocation(travelingTo) : null
            },
            platform: 'standalonewindows',
            onlineSinceMs: null
        }
    };
}

describe('groupFriendsByWorld', () => {
    it('groups online friends by world and skips private, traveling and offline ones', () => {
        const a1 = online('wrld_a:1~hidden(usr_x)');
        const a2 = online('wrld_a:2');
        const b = online('wrld_b:3');
        const grouped = groupFriendsByWorld([
            a1,
            b,
            a2,
            online('private'),
            online('traveling', 'wrld_a:9'),
            { $presence: { kind: 'offline' } },
            { $presence: { kind: 'active', platform: 'web' } }
        ]);

        expect([...grouped.keys()]).toEqual(['wrld_a', 'wrld_b']);
        expect(grouped.get('wrld_a')).toEqual([a1, a2]);
        expect(grouped.get('wrld_b')).toEqual([b]);
    });
});
