import { describe, expect, it } from 'vitest';

import type {
    LlmEndpointDto,
    LlmModelReasoning
} from '@/platform/tauri/bindings';

import {
    getEffectiveReasoningEffort,
    getModelReasoning,
    getValidReasoningEfforts,
    isOpenRouterBaseUrl,
    shouldShowReasoningEffortSelector
} from './reasoning';

function reasoning(
    modelId: string,
    supportedEfforts: string[],
    mandatory = false
): LlmModelReasoning {
    return { modelId, supportedEfforts, mandatory };
}

function endpoint(
    baseUrl: string,
    modelReasoning: LlmModelReasoning[] = [],
    models: string[] = []
): LlmEndpointDto {
    return {
        id: 'ep_1',
        name: 'Test',
        baseUrl,
        hasKey: true,
        models,
        modelReasoning,
        lastDetectedAt: null
    };
}

describe('isOpenRouterBaseUrl', () => {
    it('matches the canonical OpenRouter URL', () => {
        expect(isOpenRouterBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
        expect(isOpenRouterBaseUrl('https://openrouter.ai/api/v1/')).toBe(true);
        expect(isOpenRouterBaseUrl(' https://openrouter.ai/api/v1 ')).toBe(
            true
        );
    });

    it('rejects non-canonical URLs', () => {
        expect(isOpenRouterBaseUrl('https://openrouter.ai/api/v2')).toBe(false);
        expect(isOpenRouterBaseUrl('https://api.openai.com/v1')).toBe(false);
        expect(isOpenRouterBaseUrl('https://openrouter-proxy.example/v1')).toBe(
            false
        );
        expect(isOpenRouterBaseUrl('')).toBe(false);
    });
});

describe('getModelReasoning', () => {
    it('returns the matching reasoning entry', () => {
        const ep = endpoint('https://openrouter.ai/api/v1', [
            reasoning('model-a', ['low', 'high']),
            reasoning('model-b', ['medium'])
        ]);
        expect(getModelReasoning(ep, 'model-b')).toEqual(
            reasoning('model-b', ['medium'])
        );
    });

    it('returns null when no match is found', () => {
        const ep = endpoint('https://openrouter.ai/api/v1', [
            reasoning('model-a', ['low'])
        ]);
        expect(getModelReasoning(ep, 'model-x')).toBeNull();
    });

    it('returns null for null endpoint or model', () => {
        expect(getModelReasoning(null, 'model-a')).toBeNull();
        expect(getModelReasoning(endpoint('x'), null)).toBeNull();
    });
});

describe('getValidReasoningEfforts', () => {
    it('preserves API order and strings', () => {
        const r = reasoning('m', ['xhigh', 'high', 'medium']);
        expect(getValidReasoningEfforts(r)).toEqual([
            'xhigh',
            'high',
            'medium'
        ]);
    });

    it('excludes empty strings', () => {
        const r = reasoning('m', ['low', '', 'high']);
        expect(getValidReasoningEfforts(r)).toEqual(['low', 'high']);
    });

    it('excludes reasoning-disabling values when mandatory', () => {
        const r = reasoning('m', ['low', 'none', 'high', 'off'], true);
        expect(getValidReasoningEfforts(r)).toEqual(['low', 'high', 'off']);
    });

    it('keeps reasoning-disabling values when not mandatory', () => {
        const r = reasoning('m', ['low', 'none', 'high'], false);
        expect(getValidReasoningEfforts(r)).toEqual(['low', 'none', 'high']);
    });

    it('returns empty array for null reasoning', () => {
        expect(getValidReasoningEfforts(null)).toEqual([]);
    });

    it('accepts unknown effort strings without filtering', () => {
        const r = reasoning('m', ['ultra', 'turbo', 'minimal']);
        expect(getValidReasoningEfforts(r)).toEqual([
            'ultra',
            'turbo',
            'minimal'
        ]);
    });

    it('preserves non-empty strings without trimming or case conversion', () => {
        const r = reasoning('m', [' high ', 'NONE']);
        expect(getValidReasoningEfforts(r)).toEqual([' high ', 'NONE']);
    });
});

describe('getEffectiveReasoningEffort', () => {
    it('returns the stored value when valid', () => {
        const r = reasoning('m', ['low', 'high']);
        expect(getEffectiveReasoningEffort('high', r)).toBe('high');
    });

    it('returns null when stored value is not in valid options', () => {
        const r = reasoning('m', ['low', 'high']);
        expect(getEffectiveReasoningEffort('medium', r)).toBeNull();
    });

    it('returns null for empty stored value', () => {
        const r = reasoning('m', ['low', 'high']);
        expect(getEffectiveReasoningEffort('', r)).toBeNull();
        expect(getEffectiveReasoningEffort(null, r)).toBeNull();
    });

    it('returns null when reasoning is null', () => {
        expect(getEffectiveReasoningEffort('high', null)).toBeNull();
    });

    it('returns null when stored value is valid but excluded by mandatory', () => {
        const r = reasoning('m', ['low', 'none', 'high'], true);
        expect(getEffectiveReasoningEffort('none', r)).toBeNull();
    });

    it('matches stored values exactly without normalizing them', () => {
        const r = reasoning('m', [' high ']);
        expect(getEffectiveReasoningEffort(' high ', r)).toBe(' high ');
        expect(getEffectiveReasoningEffort('high', r)).toBeNull();
    });
});

describe('shouldShowReasoningEffortSelector', () => {
    it('returns true for OpenRouter endpoint with valid efforts', () => {
        const ep = endpoint(
            'https://openrouter.ai/api/v1',
            [reasoning('model-a', ['low', 'high'])],
            ['model-a']
        );
        expect(shouldShowReasoningEffortSelector(ep, 'model-a')).toBe(true);
    });

    it('returns false for non-OpenRouter endpoint', () => {
        const ep = endpoint(
            'https://api.openai.com/v1',
            [reasoning('model-a', ['low', 'high'])],
            ['model-a']
        );
        expect(shouldShowReasoningEffortSelector(ep, 'model-a')).toBe(false);
    });

    it('returns false when model has no reasoning metadata', () => {
        const ep = endpoint('https://openrouter.ai/api/v1', [], ['model-a']);
        expect(shouldShowReasoningEffortSelector(ep, 'model-a')).toBe(false);
    });

    it('returns false when reasoning has empty efforts', () => {
        const ep = endpoint(
            'https://openrouter.ai/api/v1',
            [reasoning('model-a', [])],
            ['model-a']
        );
        expect(shouldShowReasoningEffortSelector(ep, 'model-a')).toBe(false);
    });

    it('returns false for null endpoint or model', () => {
        expect(shouldShowReasoningEffortSelector(null, 'model-a')).toBe(false);
        expect(
            shouldShowReasoningEffortSelector(
                endpoint('https://openrouter.ai/api/v1'),
                null
            )
        ).toBe(false);
    });
});
