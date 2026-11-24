import {
    commands,
    type LlmEndpointDetectModelsInput,
    type LlmEndpointDetectModelsResult,
    type LlmEndpointDto,
    type LlmEndpointUpsertInput
} from '@/platform/tauri/bindings';
import { publishToolsStatusUpdated } from '@/shared/constants/tools';
import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import { useRuntimeStore } from '@/state/runtimeStore';

let pendingOperations = 0;
let endpointRevision = 0;

export function openLlmEndpointsManager(): void {
    useRuntimeStore.getState().setSystemHostOpen('llmEndpointsOpen', true);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function beginOperation(): void {
    pendingOperations += 1;
    useLlmEndpointsStore.getState().setStatus({ loading: true, error: null });
}

function finishOperation(): void {
    pendingOperations -= 1;
    useLlmEndpointsStore
        .getState()
        .setStatus({ loading: pendingOperations > 0 });
}

function recordError(error: unknown): void {
    useLlmEndpointsStore.getState().setStatus({ error: errorMessage(error) });
}

export async function loadLlmEndpoints(): Promise<LlmEndpointDto[]> {
    const expectedRevision = endpointRevision;
    beginOperation();
    try {
        const endpoints = await commands.appLlmEndpointList();
        if (expectedRevision === endpointRevision) {
            useLlmEndpointsStore.getState().setEndpoints(endpoints);
        }
        return endpoints;
    } catch (error) {
        recordError(error);
        throw error;
    } finally {
        finishOperation();
    }
}

export async function upsertLlmEndpoint(
    input: LlmEndpointUpsertInput
): Promise<LlmEndpointDto> {
    beginOperation();
    try {
        const saved = await commands.appLlmEndpointUpsert(input);
        endpointRevision += 1;
        useLlmEndpointsStore.getState().upsertEndpoint(saved);
        publishToolsStatusUpdated();
        return saved;
    } catch (error) {
        recordError(error);
        throw error;
    } finally {
        finishOperation();
    }
}

export async function deleteLlmEndpoint(id: string): Promise<void> {
    beginOperation();
    try {
        await commands.appLlmEndpointDelete(id);
        endpointRevision += 1;
        useLlmEndpointsStore.getState().removeEndpoint(id);
        publishToolsStatusUpdated();
    } catch (error) {
        recordError(error);
        throw error;
    } finally {
        finishOperation();
    }
}

export async function detectLlmEndpointModels(
    input: LlmEndpointDetectModelsInput
): Promise<LlmEndpointDetectModelsResult> {
    const expectedRevision = endpointRevision;
    beginOperation();
    try {
        const result = await commands.appLlmEndpointDetectModels(input);
        if (input.id && input.persist) {
            const endpoints = await commands.appLlmEndpointList();
            if (expectedRevision === endpointRevision) {
                endpointRevision += 1;
                useLlmEndpointsStore.getState().setEndpoints(endpoints);
                publishToolsStatusUpdated();
            }
        }
        return result;
    } catch (error) {
        recordError(error);
        throw error;
    } finally {
        finishOperation();
    }
}
