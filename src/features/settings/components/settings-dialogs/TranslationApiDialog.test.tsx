// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeModelRef } from '@/features/assistant/components/RuntimeModelSelect';
import type { LlmEndpointDto } from '@/platform/tauri/bindings';

import { TranslationApiDialog } from './TranslationApiDialog';

const mocks = vi.hoisted(() => ({
    endpoints: [] as LlmEndpointDto[]
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, string>) =>
            options ? `${key}:${Object.values(options).join(',')}` : key
    })
}));

vi.mock('@/localization/index', () => ({
    getLanguageName: (code: string) => code,
    languageCodes: ['en']
}));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/state/llmEndpointsStore', () => ({
    openLlmEndpointsManager: vi.fn(),
    useLlmEndpointsStore: (
        selector: (state: { endpoints: LlmEndpointDto[] }) => unknown
    ) => selector({ endpoints: mocks.endpoints })
}));

function endpoint(id: string, models: string[]): LlmEndpointDto {
    return {
        id,
        name: `Endpoint ${id}`,
        baseUrl: 'https://llm.example/v1',
        apiKey: '',
        hasKey: true,
        models,
        modelReasoning: [],
        lastDetectedAt: null
    };
}

function renderDialog({
    endpointId,
    model,
    defaultModel
}: {
    endpointId: string;
    model: string;
    defaultModel: RuntimeModelRef | null | undefined;
}) {
    const onDraftValueChange = vi.fn();
    render(
        <TranslationApiDialog
            open
            onOpenChange={vi.fn()}
            draft={{
                bioLanguage: 'en',
                translationAPIType: 'openai',
                translationAPIKey: '',
                translationEndpointId: endpointId,
                translationAPIModel: model,
                translationAPIPrompt: '',
                translationAPIReasoningEffort: ''
            }}
            onDraftValueChange={onDraftValueChange}
            providerOptions={[{ value: 'openai', label: 'LLM' }]}
            llmEndpoints={mocks.endpoints}
            integrationStatus={{ translation: 'idle' }}
            defaultModel={defaultModel}
            onTest={vi.fn()}
            onSave={vi.fn()}
        />
    );
    return { onDraftValueChange, user: userEvent.setup() };
}

function modelInput() {
    return screen.getByRole('combobox', {
        name: 'dialog.translation_api.openai.model'
    }) as HTMLInputElement;
}

describe('TranslationApiDialog LLM model', () => {
    afterEach(() => {
        cleanup();
    });

    it('clears the assignment when following the default model', async () => {
        mocks.endpoints = [endpoint('ep-1', ['chosen', 'default-model'])];
        const { onDraftValueChange, user } = renderDialog({
            endpointId: 'ep-1',
            model: 'chosen',
            defaultModel: { endpointId: 'ep-1', model: 'default-model' }
        });

        await user.click(modelInput());
        await user.click(
            await screen.findByRole('option', {
                name: 'dialog.translation_api.openai.model_follow_default:default-model'
            })
        );

        expect(onDraftValueChange).toHaveBeenCalledWith(
            'translationEndpointId',
            ''
        );
        expect(onDraftValueChange).toHaveBeenCalledWith(
            'translationAPIModel',
            ''
        );
    });

    it.each([
        [
            undefined,
            'dialog.translation_api.openai.model_follow_default_pending'
        ],
        [null, 'dialog.translation_api.openai.model_follow_default_unset']
    ])(
        'labels the follow option while the default model is %s',
        (defaultModel: null | undefined, label: string) => {
            mocks.endpoints = [endpoint('ep-1', ['default-model'])];
            renderDialog({ endpointId: '', model: '', defaultModel });

            expect(modelInput().value).toBe(label);
        }
    );

    it('marks a removed endpoint as failing', () => {
        mocks.endpoints = [endpoint('ep-2', ['other-model'])];
        renderDialog({
            endpointId: 'ep-1',
            model: 'chosen',
            defaultModel: null
        });

        expect(
            screen.getByText(
                'dialog.translation_api.openai.model_endpoint_removed'
            ).className
        ).toContain('text-destructive');
    });

    it('keeps an unselected model as a muted notice', () => {
        mocks.endpoints = [endpoint('ep-1', [])];
        renderDialog({
            endpointId: 'ep-1',
            model: 'manual-model',
            defaultModel: null
        });

        const notice = screen.getByText(
            'dialog.translation_api.openai.model_not_selected:manual-model,Endpoint ep-1'
        );
        expect(notice.className).toContain('text-muted-foreground');
        expect(notice.className).not.toContain('text-destructive');
    });
});
