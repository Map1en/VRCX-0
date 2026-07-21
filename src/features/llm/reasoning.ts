import type {
    LlmEndpointDto,
    LlmModelReasoning
} from '@/platform/tauri/bindings';

export type ReasoningEffort = string;

const OPENROUTER_CANONICAL_BASE_URL = 'https://openrouter.ai/api/v1';

export function isOpenRouterBaseUrl(baseUrl: string): boolean {
    return normalizeBaseUrl(baseUrl) === OPENROUTER_CANONICAL_BASE_URL;
}

function normalizeBaseUrl(raw: string): string {
    return raw.trim().replace(/\/+$/, '');
}

export function getModelReasoning(
    endpoint: LlmEndpointDto | null | undefined,
    modelId: string | null | undefined
): LlmModelReasoning | null {
    if (!endpoint || !modelId) {
        return null;
    }
    return (
        endpoint.modelReasoning.find((entry) => entry.modelId === modelId) ??
        null
    );
}

export function getValidReasoningEfforts(
    reasoning: LlmModelReasoning | null
): string[] {
    if (!reasoning) {
        return [];
    }
    const efforts = reasoning.supportedEfforts.filter(
        (effort) => effort.length > 0
    );
    if (reasoning.mandatory) {
        return efforts.filter((effort) => !isReasoningDisablingEffort(effort));
    }
    return efforts;
}

export function getEffectiveReasoningEffort(
    savedValue: string | null | undefined,
    reasoning: LlmModelReasoning | null
): string | null {
    if (!reasoning) {
        return null;
    }
    const value = savedValue ?? '';
    if (!value) {
        return null;
    }
    const valid = getValidReasoningEfforts(reasoning);
    return valid.includes(value) ? value : null;
}

export function shouldShowReasoningEffortSelector(
    endpoint: LlmEndpointDto | null | undefined,
    modelId: string | null | undefined
): boolean {
    if (!endpoint || !modelId) {
        return false;
    }
    if (!isOpenRouterBaseUrl(endpoint.baseUrl)) {
        return false;
    }
    const reasoning = getModelReasoning(endpoint, modelId);
    return getValidReasoningEfforts(reasoning).length > 0;
}

function isReasoningDisablingEffort(effort: string): boolean {
    return effort === 'none';
}
