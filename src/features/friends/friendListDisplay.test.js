import { describe, expect, it } from 'vitest';

import {
    languageFlagLabel,
    languageTooltipLabel,
    resolveFriendStatusMeta
} from './friendListDisplay.js';

describe('friendListDisplay', () => {
    it('shows language flags and readable fallbacks for the language column', () => {
        expect(languageFlagLabel('eng')).toBe('🇺🇸');
        expect(languageFlagLabel('unknown_language')).toBe('UNK');
        expect(languageFlagLabel('')).toBe('?');

        expect(languageTooltipLabel({ value: 'English', key: 'eng' })).toBe(
            'English (eng)'
        );
        expect(languageTooltipLabel({ key: 'jpn' })).toBe('jpn (jpn)');
        expect(languageTooltipLabel({})).toBe('');
    });

    it('shows status text, indicator state, and sort rank for friend status badges', () => {
        const active = resolveFriendStatusMeta({
            status: 'active',
            statusDescription: '',
            state: 'online'
        });
        expect(active.label).toBe('active');
        expect(active.badgeVariant).toBe('outline');
        expect(active.showIndicator).toBe(true);
        expect(active.sortRank).toEqual(expect.any(Number));

        const custom = resolveFriendStatusMeta({
            status: 'busy',
            statusDescription: 'Do not disturb'
        });
        expect(custom.label).toBe('Do not disturb');

        const empty = resolveFriendStatusMeta(null);
        expect(empty.badgeVariant).toBe('outline');
        expect(empty.showIndicator).toBe(false);
    });
});
