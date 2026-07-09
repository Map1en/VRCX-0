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
        id: 'gemini',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        models: ['gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-2.5-flash']
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro']
    },
    {
        id: 'xai',
        name: 'xAI',
        baseUrl: 'https://api.x.ai/v1',
        models: ['grok-4.5', 'grok-4']
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
        id: 'mistral',
        name: 'Mistral AI',
        baseUrl: 'https://api.mistral.ai/v1',
        models: [
            'mistral-large-latest',
            'mistral-small-latest',
            'codestral-latest'
        ]
    },
    {
        id: 'together',
        name: 'Together AI',
        baseUrl: 'https://api.together.xyz/v1',
        models: [
            'MiniMaxAI/MiniMax-M3',
            'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
            'openai/gpt-oss-20b'
        ]
    },
    {
        id: 'perplexity',
        name: 'Perplexity',
        baseUrl: 'https://api.perplexity.ai',
        models: ['sonar-pro', 'sonar']
    },
    {
        id: 'cerebras',
        name: 'Cerebras',
        baseUrl: 'https://api.cerebras.ai/v1',
        models: ['gpt-oss-120b', 'zai-glm-4.7']
    },
    {
        id: 'dashscope',
        name: 'Alibaba Cloud Model Studio',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen-plus', 'qwen-max', 'qwen-turbo']
    },
    {
        id: 'kimi',
        name: 'Kimi',
        baseUrl: 'https://api.moonshot.ai/v1',
        models: ['kimi-k2.7-code', 'kimi-k2.6']
    },
    {
        id: 'zhipu',
        name: 'Zhipu AI',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: ['glm-5.2', 'glm-4.5', 'glm-4.5-air']
    },
    {
        id: 'siliconflow',
        name: 'SiliconFlow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        models: [
            'Pro/zai-org/GLM-4.7',
            'deepseek-ai/DeepSeek-V3.2',
            'Qwen/Qwen3-32B'
        ]
    },
    {
        id: 'tencent-hunyuan',
        name: 'Tencent Hunyuan',
        baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
        models: ['hunyuan-turbos-latest', 'hunyuan-large', 'hunyuan-lite']
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
