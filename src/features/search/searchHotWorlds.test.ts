import { describe, expect, it } from 'vitest';

import { aggregateHotWorlds } from './searchHotWorlds';

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
