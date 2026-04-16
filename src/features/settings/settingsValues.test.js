import { describe, expect, it } from 'vitest';

import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters.js';

import {
    buildOpenAiModelsEndpoint,
    buildTablePageSizeOptions,
    DEFAULT_TRANSLATION_ENDPOINT,
    filterTablePageSizeOptions,
    formatByteSize,
    isValidFontFamilyList,
    normalizeSharedFeedFilters,
    normalizeTablePageSizes,
    parseIntegerInput,
    parseWebJson,
    TABLE_PAGE_SIZE_DEFAULTS
} from './settingsValues.js';

describe('settingsValues', () => {
    it('normalizes table page sizes to the sorted usable choices users can save', () => {
        expect(normalizeTablePageSizes(['50', 10, '10', 0, -5, 2000, 'bad', 25])).toEqual([
            10,
            25,
            50
        ]);
        expect(normalizeTablePageSizes(['bad', 0])).toEqual(TABLE_PAGE_SIZE_DEFAULTS);
    });

    it('builds table page size suggestions from defaults and the current draft', () => {
        const options = buildTablePageSizeOptions([12, 50, '75']);

        expect(options).toContain(12);
        expect(options).toContain(1000);
        expect(options.filter((size) => size === 50)).toHaveLength(1);
        expect(filterTablePageSizeOptions(options, '5')).toEqual(
            options.filter((size) => String(size).includes('5'))
        );
        expect(filterTablePageSizeOptions(options, '')).toEqual(options);
    });

    it('keeps shared feed filters complete while preserving saved overrides', () => {
        const filters = normalizeSharedFeedFilters({
            noty: { displayName: 'Never' },
            wrist: 'invalid'
        });

        expect(filters.noty).toEqual({
            ...sharedFeedFiltersDefaults.noty,
            displayName: 'Never'
        });
        expect(filters.wrist).toEqual(sharedFeedFiltersDefaults.wrist);
    });

    it('builds the OpenAI models endpoint from chat completion endpoints users enter', () => {
        expect(buildOpenAiModelsEndpoint(DEFAULT_TRANSLATION_ENDPOINT)).toBe(
            'https://api.openai.com/v1/models'
        );
        expect(buildOpenAiModelsEndpoint('https://proxy.example.test/openai/chat/completions?x=1#top')).toBe(
            'https://proxy.example.test/openai/models'
        );
        expect(buildOpenAiModelsEndpoint('custom-base/chat/completions')).toBe('custom-base/models');
    });

    it('parses JSON responses from web requests regardless of object or text payload shape', () => {
        expect(parseWebJson({ data: { ok: true } })).toEqual({ ok: true });
        expect(parseWebJson({ data: '{"models":["gpt"]}' })).toEqual({ models: ['gpt'] });
        expect(parseWebJson({ data: '' })).toEqual({});
    });

    it('validates custom font stacks before they are persisted', () => {
        expect(isValidFontFamilyList('"Comic Sans MS", Arial, system-ui')).toBe(true);
        expect(isValidFontFamilyList('Noto Sans JP')).toBe(true);
        expect(isValidFontFamilyList('bad;font')).toBe(false);
        expect(isValidFontFamilyList('')).toBe(false);
    });

    it('formats cache sizes into readable units for settings diagnostics', () => {
        expect(formatByteSize(0)).toBe('0 B');
        expect(formatByteSize(512)).toBe('512 B');
        expect(formatByteSize(1536)).toBe('1.50 KB');
        expect(formatByteSize(5 * 1024 * 1024)).toBe('5.00 MB');
    });

    it('uses a fallback when numeric settings input is empty or invalid', () => {
        expect(parseIntegerInput('250', 100)).toBe(250);
        expect(parseIntegerInput('abc', 100)).toBe(100);
    });
});
