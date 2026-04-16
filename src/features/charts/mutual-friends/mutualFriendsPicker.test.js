import { describe, expect, it } from 'vitest';

import { MUTUAL_GRAPH_EMPTY_USER_ID } from './mutualFriendsSettings.js';
import {
    buildMutualFriendExcludePickerOptions,
    buildMutualFriendNodePickerOptions,
    buildMutualFriendPickerOption,
    filterMutualFriendPickerOptions,
    mutualFriendPickerOptionMatches,
    truncateMutualFriendLabel
} from './mutualFriendsPicker.js';

describe('mutualFriendsPicker', () => {
    it('builds graph node picker options from roster names and visible connection counts', () => {
        const options = buildMutualFriendNodePickerOptions(
            [
                { id: 'usr_b', label: 'Cached B', degree: 1 },
                { id: 'usr_a', label: 'Cached A', degree: 3 }
            ],
            {
                usr_a: { id: 'usr_a', displayName: 'Ava', username: 'ava_user' },
                usr_b: { id: 'usr_b', username: 'ben_user' }
            }
        );

        expect(options.map((option) => option.displayLabel)).toEqual([
            'Ava (3)',
            'ben_user (1)'
        ]);
        expect(options[0]).toMatchObject({
            value: 'usr_a',
            label: 'Ava',
            degree: 3
        });
    });

    it('searches picker options by the text users can see or identify', () => {
        const option = buildMutualFriendPickerOption(
            ' usr_ava ',
            { usr_ava: { id: 'usr_ava', displayName: 'Ava Star', username: 'ava_user' } },
            '',
            5
        );

        expect(mutualFriendPickerOptionMatches(option, 'ava usr_ava')).toBe(true);
        expect(mutualFriendPickerOptionMatches(option, 'missing')).toBe(false);
        expect(filterMutualFriendPickerOptions([option, { label: 'Ben', value: 'usr_ben' }], 'usr', 1))
            .toHaveLength(1);
    });

    it('builds hidden-friend picker choices from all cached graph ids without duplicates or self', () => {
        const options = buildMutualFriendExcludePickerOptions(
            new Map([
                ['usr_self', ['usr_a', 'usr_b']],
                ['usr_a', ['usr_self', 'usr_b', MUTUAL_GRAPH_EMPTY_USER_ID]]
            ]),
            {
                usr_a: { id: 'usr_a', displayName: 'Ava' },
                usr_b: { id: 'usr_b', displayName: 'Ben' }
            },
            'usr_self'
        );

        expect(options.map((option) => option.value)).toEqual(['usr_a', 'usr_b']);
        expect(options.map((option) => option.label)).toEqual(['Ava', 'Ben']);
    });

    it('keeps long graph labels compact for node rendering', () => {
        expect(truncateMutualFriendLabel('Short name', 20)).toBe('Short name');
        expect(truncateMutualFriendLabel('Very long display name', 10)).toBe('Very long\u2026');
    });
});
