import type { LlmModelReasoning } from '@/platform/tauri/bindings';

export const CUSTOM_LLM_ENDPOINT_PROVIDER_ID = 'custom';
export const DEFAULT_LLM_ENDPOINT_PROVIDER_ID = 'openai';

export type LlmEndpointProviderId =
    | 'openai'
    | 'openrouter'
    | 'gemini'
    | 'deepseek'
    | 'xai'
    | 'siliconflow'
    | typeof CUSTOM_LLM_ENDPOINT_PROVIDER_ID;

export type LlmEndpointProviderPreset = {
    id: Exclude<LlmEndpointProviderId, typeof CUSTOM_LLM_ENDPOINT_PROVIDER_ID>;
    name: string;
    labelKey: string;
    baseUrl: string;
};

export type LlmEndpointProviderDraft = {
    id: string | null;
    savedBaseUrl: string | null;
    providerId: LlmEndpointProviderId;
    name: string;
    baseUrl: string;
    apiKey: string;
    clearKey: boolean;
    modelsText: string;
    detectedModelReasoning: LlmModelReasoning[] | null;
};

export const LLM_ENDPOINT_PROVIDER_PRESETS: LlmEndpointProviderPreset[] = [
    {
        id: 'openai',
        name: 'OpenAI',
        labelKey: 'view.tools.llm_endpoints.presets.openai',
        baseUrl: 'https://api.openai.com/v1'
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        labelKey: 'view.tools.llm_endpoints.presets.openrouter',
        baseUrl: 'https://openrouter.ai/api/v1'
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        labelKey: 'view.tools.llm_endpoints.presets.gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        labelKey: 'view.tools.llm_endpoints.presets.deepseek',
        baseUrl: 'https://api.deepseek.com'
    },
    {
        id: 'xai',
        name: 'xAI',
        labelKey: 'view.tools.llm_endpoints.presets.xai',
        baseUrl: 'https://api.x.ai/v1'
    },
    {
        id: 'siliconflow',
        name: 'SiliconFlow',
        labelKey: 'view.tools.llm_endpoints.presets.siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1'
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
    baseUrl: string,
    name: string
): LlmEndpointProviderId {
    const normalizedBaseUrl = normalizeLlmEndpointPresetBaseUrl(baseUrl);
    const normalizedName = name.trim();
    return (
        LLM_ENDPOINT_PROVIDER_PRESETS.find(
            (preset) =>
                preset.name === normalizedName &&
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
            providerId: CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
            name: '',
            baseUrl: '',
            apiKey: '',
            clearKey: false,
            modelsText: '',
            detectedModelReasoning: null
        };
    }

    return {
        ...draft,
        providerId: preset.id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        modelsText: '',
        detectedModelReasoning: null
    };
}

export function shouldUseSavedLlmEndpointForDetect(
    draft: LlmEndpointProviderDraft
): boolean {
    if (!draft.id || !draft.savedBaseUrl || draft.apiKey.trim()) {
        return false;
    }
    if (draft.clearKey) {
        return false;
    }
    return (
        normalizeLlmEndpointPresetBaseUrl(draft.baseUrl) ===
        normalizeLlmEndpointPresetBaseUrl(draft.savedBaseUrl)
    );
}

export function createEmptyLlmEndpointDraft(): LlmEndpointProviderDraft {
    return applyLlmEndpointProviderPreset(
        {
            id: null,
            savedBaseUrl: null,
            providerId: DEFAULT_LLM_ENDPOINT_PROVIDER_ID,
            name: '',
            baseUrl: '',
            apiKey: '',
            clearKey: false,
            modelsText: '',
            detectedModelReasoning: null
        },
        DEFAULT_LLM_ENDPOINT_PROVIDER_ID
    );
}
