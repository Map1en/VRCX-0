import { describe, expect, it } from 'vitest';

import {
    avatarSearchEnglishEquivalentLength,
    isAvatarSearchQueryLongEnough
} from './avatarSearchQuery';

describe('avatarSearchQuery', () => {
    it('counts ASCII characters as one English-equivalent character', () => {
        expect(avatarSearchEnglishEquivalentLength('ab')).toBe(2);
        expect(avatarSearchEnglishEquivalentLength('abc')).toBe(3);
        expect(isAvatarSearchQueryLongEnough('ab')).toBe(false);
        expect(isAvatarSearchQueryLongEnough('abc')).toBe(true);
    });

    it('counts non-ASCII characters as two English-equivalent characters', () => {
        expect(avatarSearchEnglishEquivalentLength('你')).toBe(2);
        expect(avatarSearchEnglishEquivalentLength('你好')).toBe(4);
        expect(isAvatarSearchQueryLongEnough('你')).toBe(false);
        expect(isAvatarSearchQueryLongEnough('你好')).toBe(true);
        expect(isAvatarSearchQueryLongEnough('a你')).toBe(true);
    });

    it('trims outer whitespace before measuring the query', () => {
        expect(avatarSearchEnglishEquivalentLength('  ab  ')).toBe(2);
        expect(isAvatarSearchQueryLongEnough('  ab  ')).toBe(false);
    });
});
