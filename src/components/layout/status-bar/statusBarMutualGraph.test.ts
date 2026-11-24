import { describe, expect, it } from 'vitest';

import { isMutualGraphSegmentVisible } from './statusBarMutualGraph';

describe('statusBarMutualGraph', () => {
    it('shows active and terminal runs of the current account and hides idle', () => {
        for (const status of [
            'running',
            'cancelling',
            'completed',
            'cancelled',
            'error'
        ] as const) {
            expect(
                isMutualGraphSegmentVisible(
                    { status, ownerUserId: 'usr_a' },
                    'usr_a'
                )
            ).toBe(true);
        }
        expect(
            isMutualGraphSegmentVisible(
                { status: 'idle', ownerUserId: 'usr_a' },
                'usr_a'
            )
        ).toBe(false);
    });

    it('hides a run that belongs to the previous account after a switch', () => {
        expect(
            isMutualGraphSegmentVisible(
                { status: 'running', ownerUserId: 'usr_a' },
                'usr_b'
            )
        ).toBe(false);
    });
});
