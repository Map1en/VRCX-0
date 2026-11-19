import { describe, expect, it } from 'vitest';

import type { ScreenshotFacet } from '@/platform/tauri/bindings';

import { groupScreenshotPeople } from './useScreenshotPeopleSections';

const person = (id: string): ScreenshotFacet => ({
    id,
    name: id,
    count: 1,
    lastCapturedAtMs: 0,
    coverPath: ''
});

describe('groupScreenshotPeople', () => {
    it('splits people into current friends, former friends and others in order, leaving out the current user', () => {
        const groups = groupScreenshotPeople(
            [
                person('usr_self'),
                person('usr_stranger'),
                person('usr_friend'),
                person('usr_refriended'),
                person('usr_former')
            ],
            'usr_self',
            new Set(['usr_friend', 'usr_refriended']),
            new Set(['usr_refriended', 'usr_former'])
        );

        expect(groups.friends.map((facet) => facet.id)).toEqual([
            'usr_friend',
            'usr_refriended'
        ]);
        expect(groups.formerFriends.map((facet) => facet.id)).toEqual([
            'usr_former'
        ]);
        expect(groups.others.map((facet) => facet.id)).toEqual([
            'usr_stranger'
        ]);
    });
});
