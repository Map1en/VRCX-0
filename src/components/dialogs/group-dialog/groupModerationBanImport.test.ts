import { describe, expect, it } from 'vitest';

import { extractGroupBanUserIds } from './groupModerationBanImport';

describe('extractGroupBanUserIds', () => {
    it('extracts a plain list of user ids, one per line', () => {
        expect(
            extractGroupBanUserIds(
                'usr_11111111-1111-1111-1111-111111111111\nusr_22222222-2222-2222-2222-222222222222'
            )
        ).toEqual([
            'usr_11111111-1111-1111-1111-111111111111',
            'usr_22222222-2222-2222-2222-222222222222'
        ]);
    });

    it('extracts user ids embedded anywhere in free-form or CSV text', () => {
        expect(
            extractGroupBanUserIds(
                'userId,displayName\nusr_11111111-1111-1111-1111-111111111111,Alice\nSee usr_22222222-2222-2222-2222-222222222222 for details'
            )
        ).toEqual([
            'usr_11111111-1111-1111-1111-111111111111',
            'usr_22222222-2222-2222-2222-222222222222'
        ]);
    });

    it('de-duplicates repeated user ids while preserving first-seen order', () => {
        expect(
            extractGroupBanUserIds(
                'usr_11111111-1111-1111-1111-111111111111\nusr_22222222-2222-2222-2222-222222222222\nusr_11111111-1111-1111-1111-111111111111'
            )
        ).toEqual([
            'usr_11111111-1111-1111-1111-111111111111',
            'usr_22222222-2222-2222-2222-222222222222'
        ]);
    });

    it('ignores malformed ids and returns an empty array when nothing matches', () => {
        expect(extractGroupBanUserIds('usr_not-a-valid-id')).toEqual([]);
        expect(extractGroupBanUserIds('')).toEqual([]);
        expect(extractGroupBanUserIds('   \n  ')).toEqual([]);
    });
});
