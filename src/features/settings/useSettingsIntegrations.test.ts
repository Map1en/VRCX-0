// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setTranslationApiConfigPreference } from '@/services/preferencesService';
import { toast } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    endpoints: [] as { id: string; name: string; models: string[] }[],
    load: vi.fn(),
    runtimeStatus: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appAssistantRuntimeStatus: mocks.runtimeStatus }
}));

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
        load: mocks.load
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

function runtimeStatus(endpointId: string | null, model: string | null) {
    return {
        hasAnyEndpoint: Boolean(endpointId),
        lastSelection: { endpointId, model, playbookMode: 'auto' }
    };
}

function draftLlmTranslation(
    result: ReturnType<typeof renderIntegrations>['result'],
    endpointId: string,
    model: string
) {
    act(() => {
        result.current.setTranslationDraftValue('translationAPIType', 'openai');
        result.current.setTranslationDraftValue(
            'translationEndpointId',
            endpointId
        );
        result.current.setTranslationDraftValue('translationAPIModel', model);
    });
}

describe('useSettingsIntegrations translation model', () => {
    beforeEach(() => {
        vi.mocked(setTranslationApiConfigPreference).mockClear();
        vi.mocked(toast.add).mockClear();
        mocks.endpoints = [
            { id: 'endpoint-1', name: 'Endpoint', models: ['default-model'] }
        ];
        mocks.load.mockReset();
        mocks.load.mockImplementation(async () => mocks.endpoints);
        mocks.runtimeStatus.mockReset();
        mocks.runtimeStatus.mockResolvedValue(
            runtimeStatus('endpoint-1', 'default-model')
        );
    });

    it('saves an unassigned model as following the default model', async () => {
        const { result } = renderIntegrations();
        draftLlmTranslation(result, '', '');

        await act(() => result.current.saveTranslationApiConfig());

        expect(setTranslationApiConfigPreference).toHaveBeenCalledWith(
            expect.objectContaining({
                translationEndpointId: '',
                translationAPIModel: ''
            })
        );
        expect(result.current.translationDefaultModel).toEqual({
            endpointId: 'endpoint-1',
            model: 'default-model'
        });
    });

    it('refuses to follow the default model when none is set', async () => {
        mocks.runtimeStatus.mockResolvedValue(runtimeStatus(null, null));
        const { result } = renderIntegrations();
        draftLlmTranslation(result, '', '');

        await act(() => result.current.saveTranslationApiConfig());

        expect(setTranslationApiConfigPreference).not.toHaveBeenCalled();
        expect(toast.add).toHaveBeenCalledWith({
            type: 'warning',
            title: 'dialog.translation_api.msg_no_default_model'
        });
    });

    it.each([
        ['is no longer selected on its endpoint', ['kept-model']],
        ['belongs to an endpoint without selected models', []]
    ])(
        'keeps an assigned model that %s',
        async (_case: string, models: string[]) => {
            mocks.endpoints = [{ id: 'endpoint-1', name: 'Endpoint', models }];
            const { result } = renderIntegrations();
            draftLlmTranslation(result, 'endpoint-1', 'manual-model');

            await act(() => result.current.saveTranslationApiConfig());

            expect(mocks.runtimeStatus).not.toHaveBeenCalled();
            expect(setTranslationApiConfigPreference).toHaveBeenCalledWith(
                expect.objectContaining({
                    translationEndpointId: 'endpoint-1',
                    translationAPIModel: 'manual-model'
                })
            );
        }
    );
});
