import { describe, expect, it } from 'vitest';

import { resolveUserLanguages } from './searchDisplay';

describe('search display helpers', () => {
    it('uses normalized language rows when the user already has them', () => {
        const languages = [{ key: 'eng', value: 'English' }];

        expect(
            resolveUserLanguages({
                $languages: languages,
                tags: ['language_jpn']
            })
        ).toEqual([
            { key: 'eng', value: 'English' },
            { key: 'jpn', value: '日本語' }
        ]);
    });

    it('derives user language rows from VRChat language tags', () => {
        expect(
            resolveUserLanguages({
                tags: [
                    'system_avatar_access',
                    'language_eng',
                    'language_jpn',
                    'language_custom'
                ]
            })
        ).toEqual([
            { key: 'eng', value: 'English' },
            { key: 'jpn', value: '日本語' },
            { key: 'custom', value: 'CUSTOM' }
        ]);
    });
});
