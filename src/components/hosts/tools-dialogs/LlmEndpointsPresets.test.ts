import { describe, expect, it } from 'vitest';

import {
    CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
    LLM_ENDPOINT_PROVIDER_PRESETS,
    applyLlmEndpointProviderPreset,
    findLlmEndpointProviderId,
    shouldUseSavedLlmEndpointForDetect,
    type LlmEndpointProviderDraft
} from './llmEndpointPresets';

function draft(): LlmEndpointProviderDraft {
    return {
        id: 'ep_1',
        savedBaseUrl: 'https://example.test/v1',
        providerId: CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
        name: 'Manual',
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-existing',
        clearKey: true,
        modelsText: 'manual-model'
    };
}

describe('LLM endpoint provider presets', () => {
    it('exposes only the selected common providers in the agreed order', () => {
        expect(
            LLM_ENDPOINT_PROVIDER_PRESETS.map((preset) => preset.id)
        ).toEqual(['openai', 'openrouter', 'gemini', 'deepseek', 'xai']);
    });

    it('matches providers by normalized base URL and preset name', () => {
        expect(
            findLlmEndpointProviderId(
                ' https://api.openai.com/v1/chat/completions/ ',
                'OpenAI'
            )
        ).toBe('openai');
        expect(
            findLlmEndpointProviderId('https://api.deepseek.com/', 'DeepSeek')
        ).toBe('deepseek');
        expect(
            findLlmEndpointProviderId(
                'https://generativelanguage.googleapis.com/v1beta/openai/',
                'Google Gemini'
            )
        ).toBe('gemini');
        expect(
            findLlmEndpointProviderId(
                'https://api.openai.com/v1',
                'Renamed OpenAI'
            )
        ).toBe(CUSTOM_LLM_ENDPOINT_PROVIDER_ID);
        expect(
            findLlmEndpointProviderId('https://example.test/v1', 'Manual')
        ).toBe(CUSTOM_LLM_ENDPOINT_PROVIDER_ID);
        expect(
            findLlmEndpointProviderId('https://api.openai.com/v1', ' OpenAI ')
        ).toBe('openai');
        expect(
            findLlmEndpointProviderId('https://api.openai.com/v1', 'openai')
        ).toBe(CUSTOM_LLM_ENDPOINT_PROVIDER_ID);
    });

    it('applies a preset while preserving endpoint identity and key state', () => {
        expect(applyLlmEndpointProviderPreset(draft(), 'xai')).toEqual({
            id: 'ep_1',
            savedBaseUrl: 'https://example.test/v1',
            providerId: 'xai',
            name: 'xAI',
            baseUrl: 'https://api.x.ai/v1',
            apiKey: 'sk-existing',
            clearKey: true,
            modelsText: ''
        });
    });

    it('applies additional common provider presets', () => {
        expect(applyLlmEndpointProviderPreset(draft(), 'openrouter')).toEqual({
            id: 'ep_1',
            savedBaseUrl: 'https://example.test/v1',
            providerId: 'openrouter',
            name: 'OpenRouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'sk-existing',
            clearKey: true,
            modelsText: ''
        });
    });

    it('keeps manual configuration when switching to custom', () => {
        expect(
            applyLlmEndpointProviderPreset(
                draft(),
                CUSTOM_LLM_ENDPOINT_PROVIDER_ID
            )
        ).toEqual(draft());
    });

    it('uses a saved endpoint for detect only when draft connection state is unchanged', () => {
        const unchangedDraft = {
            ...draft(),
            apiKey: '',
            clearKey: false
        };

        expect(shouldUseSavedLlmEndpointForDetect(unchangedDraft)).toBe(true);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                baseUrl: 'https://example.test/v1/'
            })
        ).toBe(true);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                baseUrl: 'https://api.deepseek.com'
            })
        ).toBe(false);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                apiKey: 'sk-new'
            })
        ).toBe(false);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                clearKey: true
            })
        ).toBe(false);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                id: null,
                savedBaseUrl: null
            })
        ).toBe(false);
    });
});
