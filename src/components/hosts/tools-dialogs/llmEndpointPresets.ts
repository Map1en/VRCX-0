export const CUSTOM_LLM_ENDPOINT_PROVIDER_ID = 'custom';
export const DEFAULT_LLM_ENDPOINT_PROVIDER_ID = 'openai';

export type LlmEndpointProviderId =
    | 'openai'
    | 'openrouter'
    | 'gemini'
    | 'deepseek'
    | 'xai'
    | 'groq'
    | 'mistral'
    | 'together'
    | 'perplexity'
    | 'cerebras'
    | 'dashscope'
    | 'kimi'
    | 'zhipu'
    | 'siliconflow'
    | 'tencent-hunyuan'
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
};

export const LLM_ENDPOINT_PROVIDER_PRESETS: LlmEndpointProviderPreset[] = [
    {
        id: 'openai',
        name: 'OpenAI',
        labelKey: 'view.tools.llm_endpoints.providers.openai',
        baseUrl: 'https://api.openai.com/v1'
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        labelKey: 'view.tools.llm_endpoints.providers.openrouter',
        baseUrl: 'https://openrouter.ai/api/v1'
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        labelKey: 'view.tools.llm_endpoints.providers.gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        labelKey: 'view.tools.llm_endpoints.providers.deepseek',
        baseUrl: 'https://api.deepseek.com'
    },
    {
        id: 'xai',
        name: 'xAI',
        labelKey: 'view.tools.llm_endpoints.providers.xai',
        baseUrl: 'https://api.x.ai/v1'
    },
    {
        id: 'groq',
        name: 'Groq',
        labelKey: 'view.tools.llm_endpoints.providers.groq',
        baseUrl: 'https://api.groq.com/openai/v1'
    },
    {
        id: 'mistral',
        name: 'Mistral AI',
        labelKey: 'view.tools.llm_endpoints.providers.mistral',
        baseUrl: 'https://api.mistral.ai/v1'
    },
    {
        id: 'together',
        name: 'Together AI',
        labelKey: 'view.tools.llm_endpoints.providers.together',
        baseUrl: 'https://api.together.xyz/v1'
    },
    {
        id: 'perplexity',
        name: 'Perplexity',
        labelKey: 'view.tools.llm_endpoints.providers.perplexity',
        baseUrl: 'https://api.perplexity.ai'
    },
    {
        id: 'cerebras',
        name: 'Cerebras',
        labelKey: 'view.tools.llm_endpoints.providers.cerebras',
        baseUrl: 'https://api.cerebras.ai/v1'
    },
    {
        id: 'dashscope',
        name: 'Alibaba Cloud Model Studio',
        labelKey: 'view.tools.llm_endpoints.providers.dashscope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    },
    {
        id: 'kimi',
        name: 'Kimi',
        labelKey: 'view.tools.llm_endpoints.providers.kimi',
        baseUrl: 'https://api.moonshot.ai/v1'
    },
    {
        id: 'zhipu',
        name: 'Zhipu AI',
        labelKey: 'view.tools.llm_endpoints.providers.zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4'
    },
    {
        id: 'siliconflow',
        name: 'SiliconFlow',
        labelKey: 'view.tools.llm_endpoints.providers.siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1'
    },
    {
        id: 'tencent-hunyuan',
        name: 'Tencent Hunyuan',
        labelKey: 'view.tools.llm_endpoints.providers.tencent-hunyuan',
        baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1'
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
        modelsText: ''
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
            modelsText: ''
        },
        DEFAULT_LLM_ENDPOINT_PROVIDER_ID
    );
}
