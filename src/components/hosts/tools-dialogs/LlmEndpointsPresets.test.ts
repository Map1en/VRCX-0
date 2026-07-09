import { describe, expect, it } from 'vitest';

import {
    CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
    applyLlmEndpointProviderPreset,
    findLlmEndpointProviderId,
    type LlmEndpointProviderDraft
} from './llmEndpointPresets';

function draft(): LlmEndpointProviderDraft {
    return {
        id: 'ep_1',
        providerId: CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
        name: 'Manual',
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-existing',
        clearKey: true,
        modelsText: 'manual-model'
    };
}

describe('LLM endpoint provider presets', () => {
    it('matches providers by normalized base URL', () => {
        expect(
            findLlmEndpointProviderId(
                ' https://api.openai.com/v1/chat/completions/ '
            )
        ).toBe('openai');
        expect(findLlmEndpointProviderId('https://api.deepseek.com/')).toBe(
            'deepseek'
        );
        expect(
            findLlmEndpointProviderId(
                'https://generativelanguage.googleapis.com/v1beta/openai/'
            )
        ).toBe('gemini');
        expect(
            findLlmEndpointProviderId(
                'https://api.hunyuan.cloud.tencent.com/v1/chat/completions'
            )
        ).toBe('tencent-hunyuan');
        expect(findLlmEndpointProviderId('https://example.test/v1')).toBe(
            CUSTOM_LLM_ENDPOINT_PROVIDER_ID
        );
    });

    it('applies a preset while preserving endpoint identity and key state', () => {
        expect(applyLlmEndpointProviderPreset(draft(), 'groq')).toEqual({
            id: 'ep_1',
            providerId: 'groq',
            name: 'Groq',
            baseUrl: 'https://api.groq.com/openai/v1',
            apiKey: 'sk-existing',
            clearKey: true,
            modelsText: ''
        });
    });

    it('applies additional common provider presets', () => {
        expect(applyLlmEndpointProviderPreset(draft(), 'kimi')).toEqual({
            id: 'ep_1',
            providerId: 'kimi',
            name: 'Kimi',
            baseUrl: 'https://api.moonshot.ai/v1',
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
});
