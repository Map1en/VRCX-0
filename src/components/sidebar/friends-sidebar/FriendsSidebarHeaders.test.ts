import { describe, expect, it } from 'vitest';

import { estimateFriendSidebarRowSize } from './FriendsSidebarHeaders';
import type { SidebarVirtualRow } from './friendsSidebarVirtualRowBuilder';

describe('estimateFriendSidebarRowSize', () => {
    it('estimates shorter friend rows in compact density', () => {
        const row = { type: 'friend', key: 'usr_a' } as SidebarVirtualRow;

        expect(estimateFriendSidebarRowSize(row, 1, true)).toBeLessThan(
            estimateFriendSidebarRowSize(row, 1, false)
        );
    });
});
