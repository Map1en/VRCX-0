// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setTranslationApiConfigPreference } from '@/services/preferencesService';

const mocks = vi.hoisted(() => ({
    endpoints: [] as { id: string; models: string[] }[],
    load: vi.fn(),
    detectModels: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: {} }));

vi.mock('@/repositories/configRepository', () => ({
    default: { getString: vi.fn().mockResolvedValue('') }
}));

vi.mock('@/services/preferencesService', () => ({
    setDiscordBoolPreference: vi.fn(),
    setTranslationApiConfigPreference: vi
        .fn()
        .mockResolvedValue({ translationAPIKey: '' }),
    setYoutubeApiKeyPreference: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('@/state/llmEndpointsStore', () => {
    const getState = () => ({
        endpoints: mocks.endpoints,
        load: mocks.load,
        detectModels: mocks.detectModels
    });
    return {
        useLlmEndpointsStore: Object.assign(
            (selector: (state: ReturnType<typeof getState>) => unknown) =>
                selector(getState()),
            { getState }
        )
    };
});

import { useSettingsIntegrations } from './useSettingsIntegrations';

function renderIntegrations() {
    return renderHook(() =>
        useSettingsIntegrations({ commit: vi.fn().mockResolvedValue(true) })
    );
}

describe('useSettingsIntegrations translation models', () => {
    beforeEach(() => {
        vi.mocked(setTranslationApiConfigPreference).mockClear();
        mocks.load.mockReset();
        mocks.load.mockImplementation(async () => mocks.endpoints);
        mocks.detectModels.mockReset();
        mocks.detectModels.mockResolvedValue({
            models: ['detected-model'],
            modelReasoning: []
        });
    });

    it('keeps the configured model list of an endpoint', async () => {
        mocks.endpoints = [{ id: 'endpoint-1', models: ['manual-model'] }];
        const { result } = renderIntegrations();

        await act(() => result.current.fetchTranslationModels('endpoint-1'));

        expect(mocks.detectModels).not.toHaveBeenCalled();
        expect(mocks.load).toHaveBeenCalledOnce();
    });

    it('preserves a manual translation model when refreshing and saving an empty endpoint', async () => {
        mocks.endpoints = [{ id: 'endpoint-1', models: [] }];
        const { result } = renderIntegrations();

        act(() => {
            result.current.setTranslationDraftValue(
                'translationAPIType',
                'openai'
            );
            result.current.setTranslationDraftValue(
                'translationEndpointId',
                'endpoint-1'
            );
            result.current.setTranslationDraftValue(
                'translationAPIModel',
                'manual-model'
            );
        });
        await act(() => result.current.fetchTranslationModels('endpoint-1'));

        expect(mocks.load).toHaveBeenCalledOnce();
        expect(mocks.detectModels).not.toHaveBeenCalled();
        expect(result.current.translationDraft.translationAPIModel).toBe(
            'manual-model'
        );
        expect(mocks.endpoints[0].models).toEqual([]);

        await act(() => result.current.saveTranslationApiConfig());

        expect(setTranslationApiConfigPreference).toHaveBeenCalledWith(
            expect.objectContaining({
                translationEndpointId: 'endpoint-1',
                translationAPIModel: 'manual-model'
            })
        );
    });

    it('replaces a removed translation model with a remaining saved selection', async () => {
        mocks.endpoints = [{ id: 'endpoint-1', models: ['kept-model'] }];
        const { result } = renderIntegrations();
        act(() => {
            result.current.setTranslationDraftValue(
                'translationEndpointId',
                'endpoint-1'
            );
            result.current.setTranslationDraftValue(
                'translationAPIModel',
                'removed-model'
            );
        });
        await act(() => result.current.fetchTranslationModels('endpoint-1'));
        expect(result.current.translationDraft.translationAPIModel).toBe(
            'kept-model'
        );
        expect(mocks.detectModels).not.toHaveBeenCalled();
    });
});
