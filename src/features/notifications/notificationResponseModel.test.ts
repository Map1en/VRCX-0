import { describe, expect, it } from 'vitest';

import { shouldOpenBoopReplyDialog } from './notificationResponseModel';

describe('shouldOpenBoopReplyDialog', () => {
    it('opens the boop reply dialog for boop reply responses', () => {
        expect(
            shouldOpenBoopReplyDialog({ type: 'boop' }, { type: 'reply' })
        ).toBe(true);
        expect(
            shouldOpenBoopReplyDialog({ type: 'boop' }, { icon: 'reply' })
        ).toBe(true);
    });

    it('keeps normal responses on the remote response path', () => {
        expect(
            shouldOpenBoopReplyDialog({ type: 'invite' }, { type: 'reply' })
        ).toBe(false);
    });
});
