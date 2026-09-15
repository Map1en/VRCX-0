import { describe, expect, it } from 'vitest';

import {
    fallbackLanguageOptions,
    languageOptionLabel,
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows,
    normalizeSelfStatusInput,
    normalizeSocialStatusPreset,
    normalizeStatusHistoryRows,
    normalizeUserId,
    selfStatusBaseOptions
} from './userProfileFields';

describe('userProfileFields', () => {
    it('prepares supported self-status values for saving', () => {
        expect(selfStatusBaseOptions.map((option) => option.value)).toEqual([
            'join me',
            'active',
            'ask me',
            'busy'
        ]);
        expect(
            selfStatusBaseOptions.find((option) => option.value === 'busy')
                ?.labelKey
        ).toBe('dialog.user.status.busy');
        expect(normalizeSelfStatusInput('joinme')).toBe('join me');
        expect(normalizeSelfStatusInput('AskMe')).toBe('ask me');
        expect(normalizeSelfStatusInput(' BUSY ')).toBe('busy');
        expect(normalizeSelfStatusInput('offline')).toBe('offline');
        expect(normalizeSelfStatusInput('invisible')).toBe('');
    });

    it('normalizes persisted social status presets at the config boundary', () => {
        expect(
            normalizeSocialStatusPreset({
                status: 'AskMe',
                statusDescription: 'World hopping'
            })
        ).toEqual({
            status: 'ask me',
            statusDescription: 'World hopping'
        });
        expect(normalizeSocialStatusPreset(null)).toEqual({ status: '' });
    });

    it('offers spoken-language options from config as clean sorted labels', () => {
        expect(
            normalizeLanguageOptionsFromConfig({
                constants: {
                    LANGUAGE: {
                        SPOKEN_LANGUAGE_OPTIONS: {
                            language_jpn: 'Japanese',
                            eng: 'English',
                            empty: '',
                            language_spa: 'Spanish'
                        }
                    }
                }
            })
        ).toEqual([
            { key: 'eng', value: 'English' },
            { key: 'jpn', value: 'Japanese' },
            { key: 'spa', value: 'Spanish' }
        ]);
        expect(fallbackLanguageOptions()).toEqual(
            expect.arrayContaining([
                { key: 'eng', value: 'English' },
                { key: 'jpn', value: '日本語' },
                { key: 'zho', value: '中文' },
                { key: 'yue', value: '廣東話' }
            ])
        );
    });

    it('shows a user language once using configured names', () => {
        const languageOptionsMap = new Map([
            ['eng', { key: 'eng', value: 'English' }],
            ['jpn', { key: 'jpn', value: 'Japanese' }],
            ['spa', { key: 'spa', value: 'Spanish' }]
        ]);

        const rows = normalizeProfileLanguageRows(
            {
                $languages: ['language_eng', { key: 'jpn', value: 'Japanese' }],
                languages: ['eng', { id: 'spa', label: 'Spanish' }],
                tags: ['language_spa', 'system_avatar_access']
            },
            languageOptionsMap
        );

        expect(rows).toEqual([
            { key: 'eng', value: 'English' },
            { key: 'jpn', value: 'Japanese' },
            { key: 'spa', value: 'Spanish' }
        ]);
        expect(languageOptionLabel(rows[0])).toBe('English (ENG)');
    });

    it('uses local language names before VRChat config finishes loading', () => {
        const rows = normalizeProfileLanguageRows({
            tags: ['language_zho', 'language_yue', 'language_custom']
        });

        expect(rows).toEqual([
            { key: 'zho', value: '中文' },
            { key: 'yue', value: '廣東話' },
            { key: 'custom', value: 'CUSTOM' }
        ]);
        expect(languageOptionLabel(rows[0])).toBe('中文 (ZHO)');
        expect(languageOptionLabel(rows[1])).toBe('廣東話 (YUE)');
        expect(languageOptionLabel({ key: 'zho' })).toBe('中文 (ZHO)');
    });

    it('prefers VRChat config names over local language fallback names', () => {
        const rows = normalizeProfileLanguageRows(
            {
                tags: ['language_zho', 'language_yue']
            },
            new Map([
                ['zho', { key: 'zho', value: 'Config Chinese' }],
                ['yue', { key: 'yue', value: 'Config Cantonese' }]
            ])
        );

        expect(rows).toEqual([
            { key: 'zho', value: 'Config Chinese' },
            { key: 'yue', value: 'Config Cantonese' }
        ]);
    });

    it('keeps cached profile language names ahead of local fallback names', () => {
        const rows = normalizeProfileLanguageRows({
            $languages: [{ key: 'zho', value: 'Cached Chinese' }]
        });

        expect(rows).toEqual([{ key: 'zho', value: 'Cached Chinese' }]);
    });

    it('treats non-object profile language payloads as empty', () => {
        expect(normalizeProfileLanguageRows(null)).toEqual([]);
        expect(normalizeProfileLanguageRows(['language_eng'])).toEqual([]);
    });

    it('suggests recent statuses as readable unique entries with profile history first', () => {
        const profileHistory = [
            'At the mirror',
            { status: 'At the mirror' },
            { statusDescription: 'World hopping' },
            '',
            ...Array.from({ length: 12 }, (_, index) => `Preset ${index}`)
        ];

        expect(
            normalizeStatusHistoryRows(
                { statusHistory: profileHistory },
                { statusHistory: ['Should not be used'] }
            )
        ).toEqual([
            'At the mirror',
            'World hopping',
            'Preset 0',
            'Preset 1',
            'Preset 2',
            'Preset 3',
            'Preset 4',
            'Preset 5',
            'Preset 6',
            'Preset 7'
        ]);

        expect(
            normalizeStatusHistoryRows(
                {},
                {
                    statusHistory: [
                        'Snapshot status',
                        { status: 'Snapshot status' }
                    ]
                }
            )
        ).toEqual(['Snapshot status']);
    });

    it('normalizes user ids before comparing or storing profile field values', () => {
        expect(normalizeUserId(' usr_123 ')).toBe('usr_123');
        expect(normalizeUserId(null)).toBe('');
        expect(normalizeUserId(42)).toBe('42');
    });
});
