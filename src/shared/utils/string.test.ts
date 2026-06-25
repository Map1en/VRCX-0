import { describe, expect, it } from 'vitest';

import {
    commaNumber,
    escapeTag,
    escapeTagRecursive,
    localeIncludes,
    normalizeString,
    removeEmojis,
    replaceBioSymbols,
    textToHex
} from './string';

describe('string utils', () => {
    it('escapes HTML-sensitive characters by char code', () => {
        expect(escapeTag(`<img src="x" onerror='alert(&)'>`)).toBe(
            '&#60;img src=&#34;x&#34; onerror=&#39;alert(&#38;)&#39;&#62;'
        );
        expect(escapeTag(null)).toBe('null');
    });

    it('escapes nested string fields in place', () => {
        const value = {
            title: '<b>bold</b>',
            nested: {
                text: '"quoted"'
            },
            list: ['A&B']
        };

        expect(escapeTagRecursive(value)).toBe(value);
        expect(value).toEqual({
            title: '&#60;b&#62;bold&#60;/b&#62;',
            nested: {
                text: '&#34;quoted&#34;'
            },
            list: ['A&#38;B']
        });
    });

    it('formats numbers and hex output from unknown inputs', () => {
        expect(commaNumber(1234567.89)).toBe('1,234,567.89');
        expect(commaNumber('not a number')).toBe('0');
        expect(commaNumber(0)).toBe('0');
        expect(textToHex('Az!')).toBe('41 7A 21');
    });

    it('matches locale-aware substrings with the supplied comparer', () => {
        const comparer = new Intl.Collator('en', {
            sensitivity: 'base'
        });

        expect(localeIncludes('Cafe noir', 'CAFÉ', comparer)).toBe(true);
        expect(localeIncludes('Cafe noir', 'tea', comparer)).toBe(false);
        expect(localeIncludes('Cafe noir', '', comparer)).toBe(true);
        expect(localeIncludes('', 'Cafe', comparer)).toBe(false);
    });

    it('trims strings and coerces non-string inputs', () => {
        expect(normalizeString('  hi  ')).toBe('hi');
        expect(normalizeString(null)).toBe('');
        expect(normalizeString(undefined)).toBe('');
        expect(normalizeString(42)).toBe('42');
        expect(normalizeString(true)).toBe('true');
    });

    it('normalizes bio symbols and removes emoji code points', () => {
        expect(replaceBioSymbols('Hi  ＠＃≺tag≻＼path  ')).toBe(
            'Hi @#<tag>\\path'
        );
        expect(replaceBioSymbols(null)).toBe('');
        expect(removeEmojis('Hello 😊 world ✨')).toBe('Hello world');
        expect(removeEmojis(null)).toBe('');
    });
});
