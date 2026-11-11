import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
    instanceCreateOptionLabel,
    instanceCreateOptionTranslation,
    pickInstanceCreateOptionIds
} from './worldInstanceCreateOptions';

const translations: Record<string, string> = {
    'dialog.new_instance.category_options.music_shows': '音乐与演出',
    'dialog.new_instance.category_options.hangout': 'Hangout',
    'dialog.new_instance.vibe_options.18_plus': '成人向',
    'dialog.new_instance.vibe_options.newcomer_friendly': '欢迎新人'
};

const t = ((key: string, options?: { defaultValue?: string }) =>
    translations[key] ?? options?.defaultValue ?? key) as TFunction;

describe('instanceCreateOptionLabel', () => {
    it('shows the English name followed by the translated name', () => {
        expect(
            instanceCreateOptionLabel(
                { id: 'icat_music', name: 'Music & Shows' },
                'category',
                t
            )
        ).toBe('Music & Shows (音乐与演出)');
        expect(
            instanceCreateOptionLabel(
                { id: 'ivib_adult', name: '18+' },
                'vibe',
                t
            )
        ).toBe('18+ (成人向)');
        expect(
            instanceCreateOptionLabel(
                { id: 'ivib_new', name: 'Newcomer Friendly' },
                'vibe',
                t
            )
        ).toBe('Newcomer Friendly (欢迎新人)');
    });

    it('shows only the English name when the translation is missing or identical', () => {
        expect(
            instanceCreateOptionLabel(
                { id: 'icat_hangout', name: 'Hangout' },
                'category',
                t
            )
        ).toBe('Hangout');
        expect(
            instanceCreateOptionLabel(
                { id: 'ivib_future', name: 'Brand New Vibe' },
                'vibe',
                t
            )
        ).toBe('Brand New Vibe');
    });
});

describe('instanceCreateOptionTranslation', () => {
    it('returns only a translation that differs from the English name', () => {
        expect(
            instanceCreateOptionTranslation(
                { id: 'icat_music', name: 'Music & Shows' },
                'category',
                t
            )
        ).toBe('音乐与演出');
        expect(
            instanceCreateOptionTranslation(
                { id: 'icat_hangout', name: 'Hangout' },
                'category',
                t
            )
        ).toBe('');
    });
});

describe('pickInstanceCreateOptionIds', () => {
    it('keeps only ids that VRChat still offers', () => {
        const options = [
            { id: 'ivib_chill', name: 'Chill' },
            { id: 'ivib_cozy', name: 'Cozy' }
        ];

        expect(
            pickInstanceCreateOptionIds(
                ['ivib_cozy', 'ivib_deleted', 'ivib_chill'],
                options
            )
        ).toEqual(['ivib_cozy', 'ivib_chill']);
        expect(pickInstanceCreateOptionIds(['ivib_chill'], [])).toEqual([]);
    });
});
