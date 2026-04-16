import { describe, expect, it } from 'vitest';

import {
    buildFavoriteIdSet,
    fallbackLanguageOptions,
    languageFlagClassName,
    languageOptionLabel,
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows,
    normalizeSelfStatusInput,
    normalizeStatusHistoryRows,
    normalizeUserId,
    selfStatusBaseOptions
} from './userProfileFields.js';

describe('userProfileFields', () => {
    it('prepares supported self-status values for saving', () => {
        expect(selfStatusBaseOptions.map((option) => option.value)).toEqual([
            'join me',
            'active',
            'ask me',
            'busy'
        ]);
        expect(normalizeSelfStatusInput('joinme')).toBe('join me');
        expect(normalizeSelfStatusInput('AskMe')).toBe('ask me');
        expect(normalizeSelfStatusInput(' BUSY ')).toBe('busy');
        expect(normalizeSelfStatusInput('offline')).toBe('offline');
        expect(normalizeSelfStatusInput('invisible')).toBe('');
    });

    it('combines favorite friend ids from cloud and local groups', () => {
        expect(
            Array.from(
                buildFavoriteIdSet([' usr_remote ', '', 'usr_shared'], {
                    groupA: ['usr_local', 'usr_shared'],
                    groupB: null,
                    groupC: ['  ', 'usr_other']
                })
            )
        ).toEqual(['usr_remote', 'usr_shared', 'usr_local', 'usr_other']);
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
                { key: 'eng', value: 'ENG' },
                { key: 'jpn', value: 'JPN' }
            ])
        );
    });

    it('shows a user language once using configured names and flag classes', () => {
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
        expect(languageFlagClassName('language_eng')).toBe('us');
        expect(languageFlagClassName('madeup')).toBe('madeup');
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
