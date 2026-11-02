import { describe, expect, it } from 'vitest';

import { encodeMentions, findMentionQuery, splitMentions } from './mentions';

describe('mentions', () => {
    it('encodes picked names longest first and leaves unknown @names alone', () => {
        expect(
            encodeMentions('@Al and @Alice B vs @Carol', {
                Al: 'usr_1',
                'Alice B': 'usr_2'
            })
        ).toBe(
            '[@Al](vrcx-0://user/open?id=usr_1) and [@Alice B](vrcx-0://user/open?id=usr_2) vs @Carol'
        );
    });

    it('splits mention tokens back out, keeping brackets inside names', () => {
        expect(
            splitMentions('hi [@Alice [VR]](vrcx-0://user/open?id=usr_1)!')
        ).toEqual([
            { kind: 'text', text: 'hi ' },
            { kind: 'mention', name: 'Alice [VR]', userId: 'usr_1' },
            { kind: 'text', text: '!' }
        ]);
        expect(splitMentions('[docs](vrcx-0://user/open?id=x)')).toEqual([
            { kind: 'text', text: '[docs](vrcx-0://user/open?id=x)' }
        ]);
    });

    it('finds an @ query only at a word start before the caret', () => {
        expect(findMentionQuery('ask @ali', 8)).toEqual({
            start: 4,
            query: 'ali'
        });
        expect(findMentionQuery('mail a@b', 8)).toBeNull();
        expect(findMentionQuery('@ali\nnext', 9)).toBeNull();
    });
});
