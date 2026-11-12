// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    t: (key: string, options?: { model?: string }) =>
        options?.model ? `${key} ${options.model}` : key,
    endpoints: [] as {
        id: string;
        name: string;
        baseUrl: string;
        apiKey: string;
        hasKey: boolean;
        models: string[];
        modelReasoning: {
            modelId: string;
            supportedEfforts: string[];
            mandatory: boolean;
        }[];
        lastDetectedAt: string | null;
    }[],
    load: vi.fn(),
    upsert: vi.fn(),
    deleteEndpoint: vi.fn(),
    detectModels: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: mocks.t
    })
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/state/llmEndpointsStore', () => ({
    mergeModels: (...lists: string[][]) => [
        ...new Set(
            lists
                .flat()
                .map((model) => model.trim())
                .filter(Boolean)
        )
    ],
    useLlmEndpointsStore: (
        selector: (state: {
            endpoints: typeof mocks.endpoints;
            loading: boolean;
            load: typeof mocks.load;
            upsert: typeof mocks.upsert;
            deleteEndpoint: typeof mocks.deleteEndpoint;
            detectModels: typeof mocks.detectModels;
        }) => unknown
    ) =>
        selector({
            endpoints: mocks.endpoints,
            loading: false,
            load: mocks.load,
            upsert: mocks.upsert,
            deleteEndpoint: mocks.deleteEndpoint,
            detectModels: mocks.detectModels
        })
}));

vi.mock('@/ui/shadcn/badge', () => ({
    Badge: ({ children }: PropsWithChildren) => <span>{children}</span>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant: _variant,
        size: _size,
        ...props
    }: PropsWithChildren<
        ComponentProps<'button'> & { variant?: string; size?: string }
    >) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => (
        <section>{children}</section>
    ),
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogFooter: ({ children }: PropsWithChildren) => (
        <footer>{children}</footer>
    ),
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/input', () => ({
    Input: (props: ComponentProps<'input'>) => <input {...props} />
}));

vi.mock('@/ui/shadcn/label', () => ({
    Label: ({ children, ...props }: ComponentProps<'label'>) => (
        <label {...props}>{children}</label>
    )
}));

vi.mock('@/ui/shadcn/select', () => ({
    Select: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectValue: () => null
}));

vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipContent: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipTrigger: ({
        children,
        render: trigger
    }: PropsWithChildren<{ render?: ReactNode }>) => <>{trigger ?? children}</>
}));

import { LlmEndpointsDialog } from './LlmEndpointsDialog';

function inputByLabel(label: string): HTMLInputElement {
    const element = screen.getByLabelText(label);
    expect(element).toBeInstanceOf(HTMLInputElement);
    return element as HTMLInputElement;
}

describe('LlmEndpointsDialog', () => {
    beforeEach(() => {
        mocks.endpoints = [];
        mocks.load.mockReset();
        mocks.upsert.mockReset();
        mocks.deleteEndpoint.mockReset();
        mocks.detectModels.mockReset();
        mocks.toastAdd.mockReset();
        mocks.load.mockResolvedValue([]);
        mocks.upsert.mockResolvedValue({});
        mocks.detectModels.mockResolvedValue({
            models: ['openai/o3'],
            modelReasoning: [
                {
                    modelId: 'openai/o3',
                    supportedEfforts: ['low', 'medium', 'high'],
                    mandatory: false
                }
            ]
        });
    });

    afterEach(() => cleanup());

    it('detects candidates without selecting or persisting them, then saves a selected model with reasoning', async () => {
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.add'
            })
        );
        fireEvent.change(
            await screen.findByLabelText('view.tools.llm_endpoints.api_key'),
            { target: { value: 'sk-test' } }
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.detect_models'
            })
        );
        const model = await screen.findByRole('checkbox', {
            name: 'openai/o3'
        });
        expect(model.getAttribute('aria-checked')).toBe('false');
        expect(mocks.detectModels).toHaveBeenCalledWith(
            expect.objectContaining({ persist: false })
        );
        expect(mocks.upsert).not.toHaveBeenCalled();
        fireEvent.click(model);
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );

        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    models: ['openai/o3'],
                    modelReasoning: [
                        {
                            modelId: 'openai/o3',
                            supportedEfforts: ['low', 'medium', 'high'],
                            mandatory: false
                        }
                    ]
                })
            )
        );
    });

    it('ignores model detection after the endpoint target changes', async () => {
        let resolveDetection: (value: {
            models: string[];
            modelReasoning: {
                modelId: string;
                supportedEfforts: string[];
                mandatory: boolean;
            }[];
        }) => void = () => undefined;
        mocks.detectModels.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveDetection = resolve;
                })
        );
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.add'
            })
        );
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'view.tools.llm_endpoints.detect_models'
            })
        );
        fireEvent.change(
            screen.getByLabelText('view.tools.llm_endpoints.base_url'),
            { target: { value: 'https://other.example/v1' } }
        );
        await act(async () => {
            resolveDetection({
                models: ['stale-model'],
                modelReasoning: []
            });
        });

        expect(mocks.toastAdd).not.toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'view.tools.llm_endpoints.models_detected'
            })
        );
    });

    it('preserves existing reasoning metadata when saving without detection', async () => {
        mocks.endpoints = [
            {
                id: 'endpoint-1',
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-existing',
                hasKey: true,
                models: ['openai/o3'],
                modelReasoning: [
                    {
                        modelId: 'openai/o3',
                        supportedEfforts: ['low', 'medium', 'high'],
                        mandatory: false
                    }
                ],
                lastDetectedAt: '2026-08-07T00:00:00.000Z'
            }
        ];

        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.edit'
            })
        );
        const apiKeyInput = inputByLabel('view.tools.llm_endpoints.api_key');
        expect(apiKeyInput.type).toBe('text');
        expect(apiKeyInput.value).toBe('sk-existing');
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'common.actions.save'
            })
        );

        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'endpoint-1',
                    apiKey: 'sk-existing',
                    modelReasoning: null
                })
            )
        );
        expect(mocks.detectModels).not.toHaveBeenCalled();
    });

    it('saves comma-separated manual IDs without requiring the Add button', async () => {
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.add'
            })
        );
        fireEvent.change(
            await screen.findByLabelText('view.tools.llm_endpoints.base_url'),
            { target: { value: 'https://llm.example/v1' } }
        );
        fireEvent.change(
            screen.getByLabelText('view.tools.llm_endpoints.models_manual'),
            {
                target: {
                    value: ' manual-model, another-model, manual-model, '
                }
            }
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );

        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    models: ['manual-model', 'another-model']
                })
            )
        );
        expect(mocks.detectModels).not.toHaveBeenCalled();
    });

    it('does not carry a stored key to a different base URL', async () => {
        mocks.endpoints = [
            {
                id: 'endpoint-1',
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-existing',
                hasKey: true,
                models: [],
                modelReasoning: [],
                lastDetectedAt: null
            }
        ];

        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.edit'
            })
        );
        fireEvent.change(
            screen.getByLabelText('view.tools.llm_endpoints.base_url'),
            { target: { value: 'https://other.example/v1' } }
        );

        const apiKeyInput = inputByLabel('view.tools.llm_endpoints.api_key');
        expect(apiKeyInput.value).toBe('');
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.detect_models'
            })
        );

        await waitFor(() => expect(mocks.detectModels).toHaveBeenCalled());
        expect(mocks.detectModels).toHaveBeenCalledWith(
            expect.objectContaining({
                baseUrl: 'https://other.example/v1',
                apiKey: null
            })
        );
    });

    it('filters candidates and selects search results without losing hidden selections', async () => {
        mocks.detectModels.mockResolvedValue({
            models: ['gpt-one', 'gpt-two', 'other-model'],
            modelReasoning: []
        });
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'view.tools.llm_endpoints.add' })
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.detect_models'
            })
        );
        fireEvent.click(
            await screen.findByRole('checkbox', { name: 'other-model' })
        );
        fireEvent.change(
            screen.getByLabelText('view.tools.llm_endpoints.models_search'),
            {
                target: { value: 'GPT' }
            }
        );
        expect(
            screen.queryByRole('checkbox', { name: 'other-model' })
        ).toBeNull();
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.models_select_visible'
            })
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'gpt-two' }));
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ models: ['other-model', 'gpt-one'] })
            )
        );
    });

    it('keeps candidates after clearing selection and saves an empty selection without detecting again', async () => {
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'view.tools.llm_endpoints.add' })
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.detect_models'
            })
        );
        fireEvent.click(
            await screen.findByRole('checkbox', { name: 'openai/o3' })
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.models_clear'
            })
        );
        expect(
            screen
                .getByRole('checkbox', { name: 'openai/o3' })
                .getAttribute('aria-checked')
        ).toBe('false');
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ models: [] })
            )
        );
        expect(mocks.detectModels).toHaveBeenCalledOnce();
    });

    it('removes a manually added ID from both candidates and selection', async () => {
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'view.tools.llm_endpoints.add' })
        );
        const input = screen.getByLabelText(
            'view.tools.llm_endpoints.models_manual'
        );
        fireEvent.change(input, {
            target: { value: 'keep-model, remove-model' }
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.models_add'
            })
        );
        // Removing an unchecked ID must remove it from bulk-selection candidates too.
        fireEvent.click(screen.getByRole('checkbox', { name: 'remove-model' }));
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.models_remove remove-model'
            })
        );
        expect(
            screen.queryByRole('checkbox', { name: 'remove-model' })
        ).toBeNull();
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.models_select_visible'
            })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ models: ['keep-model'] })
            )
        );
    });

    it('deletes the last saved manual ID and keeps it removed when reopening the editor', async () => {
        mocks.endpoints = [
            {
                id: 'endpoint-1',
                name: 'Manual',
                baseUrl: 'https://example.test/v1',
                apiKey: '',
                hasKey: false,
                models: ['custom-model'],
                modelReasoning: [],
                lastDetectedAt: null
            }
        ];
        mocks.upsert.mockImplementation(async (input) => {
            mocks.endpoints[0] = {
                ...mocks.endpoints[0],
                models: input.models
            };
            return mocks.endpoints[0];
        });
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.edit'
            })
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.models_remove custom-model'
            })
        );
        expect(
            screen.queryByRole('checkbox', { name: 'custom-model' })
        ).toBeNull();
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'endpoint-1', models: [] })
            )
        );
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'view.tools.llm_endpoints.edit'
            })
        );
        expect(
            screen.queryByRole('checkbox', { name: 'custom-model' })
        ).toBeNull();
        expect(mocks.detectModels).not.toHaveBeenCalled();
    });

    it('allows manual models after detection fails and ignores Enter during IME composition', async () => {
        mocks.detectModels.mockRejectedValue(new Error('catalog unavailable'));
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'view.tools.llm_endpoints.add' })
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.detect_models'
            })
        );
        await waitFor(() =>
            expect(mocks.toastAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    title: 'catalog unavailable'
                })
            )
        );
        const input = screen.getByLabelText(
            'view.tools.llm_endpoints.models_manual'
        );
        fireEvent.change(input, { target: { value: 'custom-model' } });
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
        expect(
            screen.queryByRole('checkbox', { name: 'custom-model' })
        ).toBeNull();
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(
            screen
                .getByRole('checkbox', { name: 'custom-model' })
                .getAttribute('aria-checked')
        ).toBe('true');
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ models: ['custom-model'] })
            )
        );
    });

    it('opens row detection in the editor and leaves stored settings untouched on cancel', async () => {
        mocks.endpoints = [
            {
                id: 'endpoint-1',
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: '',
                hasKey: true,
                models: ['saved-model'],
                modelReasoning: [],
                lastDetectedAt: null
            }
        ];
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.detect_models'
            })
        );
        await screen.findByRole('checkbox', { name: 'openai/o3' });
        expect(
            screen
                .getByRole('checkbox', { name: 'saved-model' })
                .getAttribute('aria-checked')
        ).toBe('true');
        expect(mocks.detectModels).toHaveBeenCalledWith({
            id: 'endpoint-1',
            baseUrl: null,
            apiKey: null,
            persist: false
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.cancel' })
        );
        expect(mocks.upsert).not.toHaveBeenCalled();
        expect(mocks.endpoints[0].models).toEqual(['saved-model']);
    });
});
