import { describe, expect, it } from 'vitest';

import { resolvePrivacyLockPhase } from './privacyLockPhase';

const snapshot = (
    overrides: Partial<Parameters<typeof resolvePrivacyLockPhase>[1]> = {}
) => ({
    revision: 1,
    userId: 'usr_1',
    locked: false,
    hasPassword: true,
    ...overrides
});

describe('resolvePrivacyLockPhase', () => {
    it('is inactive without a signed-in user', () => {
        expect(resolvePrivacyLockPhase(null, snapshot())).toBe('inactive');
        expect(resolvePrivacyLockPhase('', snapshot())).toBe('inactive');
    });

    it('stays pending until the snapshot belongs to the current user', () => {
        expect(resolvePrivacyLockPhase('usr_1', snapshot({ userId: '' }))).toBe(
            'pending'
        );
        expect(
            resolvePrivacyLockPhase('usr_1', snapshot({ userId: 'usr_2' }))
        ).toBe('pending');
    });

    it('reports the lock state once the snapshot matches', () => {
        expect(
            resolvePrivacyLockPhase('usr_1', snapshot({ locked: true }))
        ).toBe('locked');
        expect(resolvePrivacyLockPhase('usr_1', snapshot())).toBe('unlocked');
    });
});
