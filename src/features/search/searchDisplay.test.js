import { describe, expect, it } from 'vitest';

import { languageFlagLabel, resolveUserLanguages } from './searchDisplay.js';

describe('search display helpers', () => {
    it('uses normalized language rows when the user already has them', () => {
        const languages = [{ key: 'eng', value: 'English' }];

        expect(resolveUserLanguages({ $languages: languages, tags: ['language_jpn'] })).toBe(languages);
    });

    it('derives user language rows from VRChat language tags', () => {
        expect(
            resolveUserLanguages({
                tags: ['system_avatar_access', 'language_eng', 'language_jpn', 'language_custom']
            })
        ).toEqual([
            { key: 'eng', value: 'us' },
            { key: 'jpn', value: 'jp' },
            { key: 'custom', value: 'custom' }
        ]);
    });

    it('renders known languages as regional indicator flags and unknown languages as short labels', () => {
        expect(languageFlagLabel('eng')).toBe(String.fromCodePoint(0x1f1fa, 0x1f1f8));
        expect(languageFlagLabel('custom')).toBe('CUS');
        expect(languageFlagLabel('')).toBe('?');
    });
});
