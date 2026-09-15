import { describe, expect, it } from 'vitest';

import { buildFavoriteIdSet } from './favoriteIdSet';

describe('buildFavoriteIdSet', () => {
    it('combines remote and local favorite friend ids once, remote first', () => {
        expect(
            Array.from(
                buildFavoriteIdSet([' usr_remote ', '', 'usr_shared'], {
                    groupA: ['usr_local', 'usr_shared'],
                    groupC: ['  ', 'usr_other']
                })
            )
        ).toEqual(['usr_remote', 'usr_shared', 'usr_local', 'usr_other']);
    });

    it('treats missing sources as empty', () => {
        expect(buildFavoriteIdSet(null, undefined).size).toBe(0);
    });
});
