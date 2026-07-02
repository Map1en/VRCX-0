import { create } from 'zustand';

import {
    commands,
    type LlmEndpointDetectModelsInput,
    type LlmEndpointDto,
    type LlmEndpointUpsertInput
} from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

export function openLlmEndpointsManager(): void {
    useRuntimeStore.getState().setSystemHostOpen('llmEndpointsOpen', true);
}

type LlmEndpointsStoreState = {
    endpoints: LlmEndpointDto[];
    loading: boolean;
    error: string | null;
    load: () => Promise<LlmEndpointDto[]>;
    upsert: (input: LlmEndpointUpsertInput) => Promise<LlmEndpointDto>;
    deleteEndpoint: (id: string) => Promise<void>;
    detectModels: (input: LlmEndpointDetectModelsInput) => Promise<string[]>;
};

export function mergeManualModels(
    existingModels: string[],
    manualInput: string
): string[] {
    const manualModels = manualInput
        .split(/[\n,]/)
        .map((model) => model.trim())
        .filter(Boolean);
    const models = [...existingModels, ...manualModels];
    models.sort();
    return [...new Set(models)];
}

export function fallbackEndpointIdAfterDelete(
    endpoints: LlmEndpointDto[],
    removedId: string,
    selectedEndpointId: string | null
): string | null {
    if (selectedEndpointId !== removedId) {
        return selectedEndpointId;
    }
    return endpoints.find((endpoint) => endpoint.id !== removedId)?.id ?? null;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export const useLlmEndpointsStore = create<LlmEndpointsStoreState>((set) => ({
    endpoints: [],
    loading: false,
    error: null,
    async load() {
        set({ loading: true, error: null });
        try {
            const endpoints = await commands.appLlmEndpointList();
            set({ endpoints, loading: false });
            return endpoints;
        } catch (error) {
            const message = errorMessage(error);
            set({ error: message, loading: false });
            throw error;
        }
    },
    async upsert(input) {
        set({ loading: true, error: null });
        try {
            const saved = await commands.appLlmEndpointUpsert(input);
            set((state) => {
                const exists = state.endpoints.some(
                    (endpoint) => endpoint.id === saved.id
                );
                return {
                    endpoints: exists
                        ? state.endpoints.map((endpoint) =>
                              endpoint.id === saved.id ? saved : endpoint
                          )
                        : [...state.endpoints, saved],
                    loading: false
                };
            });
            return saved;
        } catch (error) {
            const message = errorMessage(error);
            set({ error: message, loading: false });
            throw error;
        }
    },
    async deleteEndpoint(id) {
        set({ loading: true, error: null });
        try {
            await commands.appLlmEndpointDelete(id);
            set((state) => ({
                endpoints: state.endpoints.filter(
                    (endpoint) => endpoint.id !== id
                ),
                loading: false
            }));
        } catch (error) {
            const message = errorMessage(error);
            set({ error: message, loading: false });
            throw error;
        }
    },
    async detectModels(input) {
        set({ loading: true, error: null });
        try {
            const models = await commands.appLlmEndpointDetectModels(input);
            if (input.id) {
                set((state) => ({
                    endpoints: state.endpoints.map((endpoint) =>
                        endpoint.id === input.id
                            ? {
                                  ...endpoint,
                                  models,
                                  lastDetectedAt: new Date().toISOString()
                              }
                            : endpoint
                    ),
                    loading: false
                }));
            } else {
                set({ loading: false });
            }
            return models;
        } catch (error) {
            const message = errorMessage(error);
            set({ error: message, loading: false });
            throw error;
        }
    }
}));
