import { describe, expect, it } from 'vitest';

import {
    instanceLanguageBadges,
    instanceLanguageRows
} from './instanceLanguages';

const names: Record<string, string> = {
    eng: 'English',
    jpn: 'Japanese',
    zho: 'Chinese'
};

const labels = {
    declared: (languages: string) => `Host: ${languages}`,
    current: (languages: string) => `Now: ${languages}`
};

describe('instanceLanguageRows', () => {
    it('names languages through their ISO 639 keys and orders them by share', () => {
        const rows = instanceLanguageRows(
            {
                languages: ['en', 'zh-cn', 'zh-tw'],
                languagesIso639: ['eng', 'zho'],
                languageRatio: { en: 0.25, 'zh-cn': 0.5, 'zh-tw': 0.25 }
            },
            (key) => names[key]
        );

        expect(rows).toEqual([
            {
                code: 'zh-cn',
                iso639: 'zho',
                label: 'Chinese (CN)',
                percent: 50,
                declared: false
            },
            {
                code: 'en',
                iso639: 'eng',
                label: 'English',
                percent: 25,
                declared: false
            },
            {
                code: 'zh-tw',
                iso639: 'zho',
                label: 'Chinese (TW)',
                percent: 25,
                declared: false
            }
        ]);
        expect(instanceLanguageBadges(rows, labels)).toEqual([
            { code: 'ZHO', tooltip: 'Chinese (CN) 50% · Chinese (TW) 25%' },
            { code: 'ENG', tooltip: 'English 25%' }
        ]);
    });

    it('shows the host languages as badges even before anyone joins', () => {
        const rows = instanceLanguageRows(
            {
                creationLanguages: ['zh-CN', 'ja'],
                languages: ['zh-CN', 'ja'],
                languagesIso639: ['zho', 'jpn'],
                languageRatio: {}
            },
            (key) => names[key]
        );

        expect(instanceLanguageBadges(rows, labels)).toEqual([
            { code: 'ZHO', tooltip: 'Host: Chinese (CN) · Japanese' },
            { code: 'JPN', tooltip: 'Host: Chinese (CN) · Japanese' }
        ]);
    });

    it('keeps host languages first and lists who is actually there separately', () => {
        const rows = instanceLanguageRows(
            {
                creationLanguages: ['ja'],
                languages: ['ja', 'en'],
                languagesIso639: ['jpn', 'eng'],
                languageRatio: { en: 0.75, ja: 0.25 }
            },
            (key) => names[key]
        );

        expect(rows.map((row) => [row.code, row.declared])).toEqual([
            ['ja', true],
            ['en', false]
        ]);
        expect(instanceLanguageBadges(rows, labels)).toEqual([
            {
                code: 'JPN',
                tooltip: 'Host: Japanese\nNow: English 75% · Japanese 25%'
            }
        ]);
    });

    it('keeps slim ratios without ISO codes out of the badges', () => {
        const rows = instanceLanguageRows(
            { languageRatio: { ja: 0.47, 'zh-CN': 0.35 } },
            () => undefined
        );

        expect(rows.map((row) => row.code)).toEqual(['ja', 'zh-CN']);
        expect(instanceLanguageBadges(rows, labels)).toEqual([]);
    });

    it('returns nothing for instances without language data', () => {
        expect(instanceLanguageRows({}, () => undefined)).toEqual([]);
    });
});
