export const CUSTOM_LLM_ENDPOINT_PROVIDER_ID = 'custom';
export const DEFAULT_LLM_ENDPOINT_PROVIDER_ID = 'openai';

export type LlmEndpointProviderId =
    | 'openai'
    | 'openrouter'
    | 'groq'
    | 'deepseek'
    | typeof CUSTOM_LLM_ENDPOINT_PROVIDER_ID;

export type LlmEndpointProviderPreset = {
    id: Exclude<LlmEndpointProviderId, typeof CUSTOM_LLM_ENDPOINT_PROVIDER_ID>;
    name: string;
    baseUrl: string;
    models: string[];
};

export type LlmEndpointProviderDraft = {
    id: string | null;
    providerId: LlmEndpointProviderId;
    name: string;
    baseUrl: string;
    apiKey: string;
    clearKey: boolean;
    modelsText: string;
};

export const LLM_ENDPOINT_PROVIDER_PRESETS: LlmEndpointProviderPreset[] = [
    {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5']
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: ['~openai/gpt-latest']
    },
    {
        id: 'groq',
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        models: [
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant',
            'openai/gpt-oss-120b'
        ]
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro']
    }
];

export function isLlmEndpointProviderId(
    value: string | null | undefined
): value is LlmEndpointProviderId {
    return (
        value === CUSTOM_LLM_ENDPOINT_PROVIDER_ID ||
        LLM_ENDPOINT_PROVIDER_PRESETS.some((preset) => preset.id === value)
    );
}

export function normalizeLlmEndpointPresetBaseUrl(raw: string): string {
    let value = raw.trim().replace(/\/+$/, '');
    if (value.toLowerCase().endsWith('/chat/completions')) {
        value = value.slice(0, -'/chat/completions'.length);
    }
    return value.replace(/\/+$/, '');
}

export function findLlmEndpointProviderId(
    baseUrl: string
): LlmEndpointProviderId {
    const normalizedBaseUrl = normalizeLlmEndpointPresetBaseUrl(baseUrl);
    return (
        LLM_ENDPOINT_PROVIDER_PRESETS.find(
            (preset) =>
                normalizeLlmEndpointPresetBaseUrl(preset.baseUrl) ===
                normalizedBaseUrl
        )?.id ?? CUSTOM_LLM_ENDPOINT_PROVIDER_ID
    );
}

export function getLlmEndpointProviderPreset(
    providerId: LlmEndpointProviderId
): LlmEndpointProviderPreset | null {
    return (
        LLM_ENDPOINT_PROVIDER_PRESETS.find(
            (preset) => preset.id === providerId
        ) ?? null
    );
}

export function applyLlmEndpointProviderPreset(
    draft: LlmEndpointProviderDraft,
    providerId: LlmEndpointProviderId
): LlmEndpointProviderDraft {
    const preset = getLlmEndpointProviderPreset(providerId);
    if (!preset) {
        return {
            ...draft,
            providerId: CUSTOM_LLM_ENDPOINT_PROVIDER_ID
        };
    }

    return {
        ...draft,
        providerId: preset.id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        modelsText: preset.models.join('\n')
    };
}

export function createEmptyLlmEndpointDraft(): LlmEndpointProviderDraft {
    return applyLlmEndpointProviderPreset(
        {
            id: null,
            providerId: DEFAULT_LLM_ENDPOINT_PROVIDER_ID,
            name: '',
            baseUrl: '',
            apiKey: '',
            clearKey: false,
            modelsText: ''
        },
        DEFAULT_LLM_ENDPOINT_PROVIDER_ID
    );
}
