import { describe, expect, it } from 'vitest';

import { encodeMentions, findMentionQuery, splitMentions } from './mentions';

describe('mentions', () => {
    it('encodes picked names longest first and leaves unknown @names alone', () => {
        expect(
            encodeMentions('@Al and @Alice B vs @Carol at @Night Pier', {
                Al: { kind: 'user', id: 'usr_1', name: 'Al' },
                'Alice B': { kind: 'user', id: 'usr_2', name: 'Alice B' },
                'Night Pier': {
                    kind: 'world',
                    id: 'wrld_1',
                    name: 'Night Pier'
                }
            })
        ).toBe(
            '[@Al](vrcx-0://user/open?id=usr_1) and [@Alice B](vrcx-0://user/open?id=usr_2) vs @Carol at [@Night Pier](vrcx-0://world/open?id=wrld_1)'
        );
    });

    it('splits mention tokens back out, keeping brackets inside names', () => {
        expect(
            splitMentions(
                'hi [@Alice [VR]](vrcx-0://user/open?id=usr_1) at [@Pier](vrcx-0://world/open?id=wrld_1)!'
            )
        ).toEqual([
            { kind: 'text', text: 'hi ' },
            {
                kind: 'mention',
                target: { kind: 'user', id: 'usr_1', name: 'Alice [VR]' }
            },
            { kind: 'text', text: ' at ' },
            {
                kind: 'mention',
                target: { kind: 'world', id: 'wrld_1', name: 'Pier' }
            },
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
