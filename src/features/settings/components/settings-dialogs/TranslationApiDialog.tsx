import { useTranslation } from 'react-i18next';

import {
    RuntimeModelSelect,
    type RuntimeModelRef
} from '@/features/assistant/components/RuntimeModelSelect';
import {
    getEffectiveReasoningEffort,
    getModelReasoning,
    getValidReasoningEfforts,
    shouldShowReasoningEffortSelector
} from '@/features/llm/reasoning';
import { getLanguageName, languageCodes } from '@/localization/index';
import type {
    LlmEndpointDto,
    TranslationProvider
} from '@/platform/tauri/bindings';
import { openExternalLink } from '@/services/entityMediaService';
import { openLlmEndpointsManager } from '@/state/llmEndpointsStore';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';

import { Field, FieldGroup } from '../SettingsField';

type TranslationDraft = {
    bioLanguage: string;
    translationAPIType: TranslationProvider;
    translationAPIKey: string;
    translationEndpointId: string;
    translationAPIModel: string;
    translationAPIPrompt: string;
    translationAPIReasoningEffort: string;
};

type TranslationProviderOption = {
    value: TranslationProvider;
    label?: string;
    labelKey?: string;
};

type TranslationApiDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    draft: TranslationDraft;
    onDraftValueChange: (key: keyof TranslationDraft, value: string) => void;
    providerOptions: readonly TranslationProviderOption[];
    llmEndpoints: LlmEndpointDto[];
    integrationStatus: {
        translation: string;
    };
    defaultModel: RuntimeModelRef | null | undefined;
    onTest: () => void | Promise<void>;
    onSave: () => void | Promise<void>;
};

export function TranslationApiDialog({
    open: translationApiDialogOpen,
    onOpenChange: setTranslationApiDialogOpen,
    draft: translationDraft,
    onDraftValueChange: setTranslationDraftValue,
    providerOptions: translationProviderOptions,
    llmEndpoints,
    integrationStatus,
    defaultModel,
    onTest: testTranslationApiConfig,
    onSave: saveTranslationApiConfig
}: TranslationApiDialogProps) {
    const { t } = useTranslation();
    const translationProvider = translationDraft.translationAPIType;
    const endpoints = llmEndpoints;
    const assignedEndpointId = translationDraft.translationEndpointId.trim();
    const assignedModel = translationDraft.translationAPIModel.trim();
    const assignment =
        assignedEndpointId && assignedModel
            ? { endpointId: assignedEndpointId, model: assignedModel }
            : null;
    const assignedEndpoint = assignment
        ? endpoints.find((endpoint) => endpoint.id === assignment.endpointId)
        : undefined;
    const resolvedModel = assignment ?? defaultModel;
    const selectedEndpoint = resolvedModel
        ? endpoints.find((endpoint) => endpoint.id === resolvedModel.endpointId)
        : undefined;
    const selectedModel = resolvedModel?.model ?? '';
    const assignmentNotice = !assignment
        ? null
        : !assignedEndpoint
          ? {
                failing: true,
                text: t('dialog.translation_api.openai.model_endpoint_removed')
            }
          : !assignedEndpoint.models.includes(assignment.model)
            ? {
                  failing: false,
                  text: t('dialog.translation_api.openai.model_not_selected', {
                      model: assignment.model,
                      endpoint: assignedEndpoint.name
                  })
              }
            : null;
    const followDefaultLabel = defaultModel
        ? t('dialog.translation_api.openai.model_follow_default', {
              model: defaultModel.model
          })
        : defaultModel === null
          ? t('dialog.translation_api.openai.model_follow_default_unset')
          : t('dialog.translation_api.openai.model_follow_default_pending');
    const showReasoningEffort = shouldShowReasoningEffortSelector(
        selectedEndpoint ?? null,
        selectedModel || null
    );
    const reasoningEffortOptions = showReasoningEffort
        ? getValidReasoningEfforts(
              (selectedEndpoint?.modelReasoning ?? []).find(
                  (r) => r.modelId === selectedModel
              ) ?? null
          )
        : [];
    const effectiveReasoningEffort = showReasoningEffort
        ? (getEffectiveReasoningEffort(
              translationDraft.translationAPIReasoningEffort,
              getModelReasoning(selectedEndpoint ?? null, selectedModel || null)
          ) ?? '')
        : '';
    const apiKeyLabel =
        translationProvider === 'deepl'
            ? t('dialog.translation_api.deepl.api_key')
            : t('dialog.translation_api.description');
    const apiKeyPlaceholder =
        translationProvider === 'deepl'
            ? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx'
            : 'AIzaSy...';

    return (
        <Dialog
            open={translationApiDialogOpen}
            onOpenChange={setTranslationApiDialogOpen}
        >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.translation_api.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.translation_api.description')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field
                        label={t(
                            'view.settings.appearance.appearance.bio_language'
                        )}
                        controlId="settings-translation-bio-language"
                    >
                        <Select
                            value={translationDraft.bioLanguage || 'en'}
                            onValueChange={(value) =>
                                setTranslationDraftValue(
                                    'bioLanguage',
                                    value ?? ''
                                )
                            }
                        >
                            <SelectTrigger
                                id="settings-translation-bio-language"
                                className="w-56"
                            >
                                <SelectValue>
                                    {getLanguageName(
                                        translationDraft.bioLanguage || 'en'
                                    )}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {languageCodes.map((code: string) => (
                                        <SelectItem key={code} value={code}>
                                            {getLanguageName(code)}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        label={t('dialog.translation_api.mode')}
                        controlId="settings-translation-mode"
                    >
                        <Select
                            value={translationDraft.translationAPIType}
                            items={translationProviderOptions.map((option) => ({
                                value: option.value,
                                label:
                                    option.label ||
                                    (option.labelKey ? t(option.labelKey) : '')
                            }))}
                            onValueChange={(value) =>
                                setTranslationDraftValue(
                                    'translationAPIType',
                                    value ?? ''
                                )
                            }
                        >
                            <SelectTrigger
                                id="settings-translation-mode"
                                className="w-56"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {translationProviderOptions.map(
                                        (option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label ||
                                                    (option.labelKey
                                                        ? t(option.labelKey)
                                                        : '')}
                                            </SelectItem>
                                        )
                                    )}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    {translationDraft.translationAPIType === 'openai' ? (
                        <>
                            <Field
                                label={t('dialog.translation_api.openai.model')}
                                description={t(
                                    'dialog.translation_api.openai.model_description'
                                )}
                                controlId="settings-translation-model"
                            >
                                <div className="flex w-96 max-w-full flex-col gap-1.5">
                                    <RuntimeModelSelect
                                        id="settings-translation-model"
                                        endpointId={
                                            assignment?.endpointId ?? null
                                        }
                                        model={assignment?.model ?? null}
                                        placeholder={t(
                                            'assistant.runtime.search_models'
                                        )}
                                        emptyLabel={t(
                                            'assistant.runtime.model_unset'
                                        )}
                                        followDefault={{
                                            label: followDefaultLabel,
                                            onSelect: () => {
                                                setTranslationDraftValue(
                                                    'translationEndpointId',
                                                    ''
                                                );
                                                setTranslationDraftValue(
                                                    'translationAPIModel',
                                                    ''
                                                );
                                                normalizeReasoningEffortForModel(
                                                    endpoints.find(
                                                        (endpoint) =>
                                                            endpoint.id ===
                                                            defaultModel?.endpointId
                                                    ) ?? null,
                                                    defaultModel?.model ?? '',
                                                    translationDraft.translationAPIReasoningEffort,
                                                    setTranslationDraftValue
                                                );
                                            }
                                        }}
                                        onSelect={(ref) => {
                                            setTranslationDraftValue(
                                                'translationEndpointId',
                                                ref.endpointId
                                            );
                                            setTranslationDraftValue(
                                                'translationAPIModel',
                                                ref.model
                                            );
                                            normalizeReasoningEffortForModel(
                                                endpoints.find(
                                                    (endpoint) =>
                                                        endpoint.id ===
                                                        ref.endpointId
                                                ) ?? null,
                                                ref.model,
                                                translationDraft.translationAPIReasoningEffort,
                                                setTranslationDraftValue
                                            );
                                        }}
                                    />
                                    {assignmentNotice ? (
                                        <p
                                            className={
                                                assignmentNotice.failing
                                                    ? 'text-destructive text-xs'
                                                    : 'text-muted-foreground text-xs'
                                            }
                                        >
                                            {assignmentNotice.text}
                                        </p>
                                    ) : null}
                                </div>
                            </Field>
                            {showReasoningEffort ? (
                                <Field
                                    label={t(
                                        'dialog.translation_api.openai.reasoning_effort'
                                    )}
                                    controlId="settings-translation-reasoning-effort"
                                >
                                    <Select
                                        value={effectiveReasoningEffort}
                                        items={reasoningEffortOptions.map(
                                            (effort) => ({
                                                value: effort,
                                                label: effort
                                            })
                                        )}
                                        onValueChange={(value) =>
                                            setTranslationDraftValue(
                                                'translationAPIReasoningEffort',
                                                value ?? ''
                                            )
                                        }
                                    >
                                        <SelectTrigger
                                            id="settings-translation-reasoning-effort"
                                            className="data-placeholder:text-foreground w-96 max-w-full"
                                        >
                                            <SelectValue>
                                                {effectiveReasoningEffort ||
                                                    t(
                                                        'dialog.translation_api.openai.reasoning_effort_provider_default'
                                                    )}
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                <SelectItem value="">
                                                    {t(
                                                        'dialog.translation_api.openai.reasoning_effort_provider_default'
                                                    )}
                                                </SelectItem>
                                                {reasoningEffortOptions.map(
                                                    (effort) => (
                                                        <SelectItem
                                                            key={effort}
                                                            value={effort}
                                                        >
                                                            {effort}
                                                        </SelectItem>
                                                    )
                                                )}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </Field>
                            ) : null}
                            <Field
                                label={t(
                                    'dialog.translation_api.openai.prompt_optional'
                                )}
                                description={t(
                                    'dialog.translation_api.openai.prompt_optional_description'
                                )}
                                controlId="settings-translation-prompt"
                                className="lg:grid-cols-1"
                                controlClassName="w-full"
                            >
                                <Textarea
                                    id="settings-translation-prompt"
                                    rows={3}
                                    name="translationApiPrompt"
                                    value={
                                        translationDraft.translationAPIPrompt
                                    }
                                    onChange={(event) =>
                                        setTranslationDraftValue(
                                            'translationAPIPrompt',
                                            event.target.value
                                        )
                                    }
                                    className="field-sizing-fixed max-h-[50vh] min-h-30 w-full resize-y overflow-y-auto"
                                />
                            </Field>
                        </>
                    ) : null}
                    {translationDraft.translationAPIType !== 'openai' ? (
                        <Field
                            label={apiKeyLabel}
                            controlId="settings-translation-api-key"
                        >
                            <Input
                                id="settings-translation-api-key"
                                type="text"
                                name="translationApiKey"
                                value={translationDraft.translationAPIKey}
                                placeholder={apiKeyPlaceholder}
                                onChange={(event) =>
                                    setTranslationDraftValue(
                                        'translationAPIKey',
                                        event.target.value
                                    )
                                }
                                className="w-96 max-w-full"
                            />
                        </Field>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
                    {translationDraft.translationAPIType === 'openai' ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                setTranslationApiDialogOpen(false);
                                openLlmEndpointsManager();
                            }}
                        >
                            {t('assistant.runtime.manage_endpoints')}
                        </Button>
                    ) : null}
                    {translationDraft.translationAPIType === 'google' ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                openExternalLink(
                                    'https://translatepress.com/docs/automatic-translation/generate-google-api-key/'
                                );
                            }}
                        >
                            {t('dialog.translation_api.guide')}
                        </Button>
                    ) : null}
                    {translationDraft.translationAPIType === 'deepl' ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                openExternalLink(
                                    'https://www.deepl.com/pro-api'
                                );
                            }}
                        >
                            {t('dialog.translation_api.guide')}
                        </Button>
                    ) : null}
                    {translationDraft.translationAPIType === 'openai' ||
                    translationDraft.translationAPIType === 'deepl' ? (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={
                                integrationStatus.translation === 'running'
                            }
                            onClick={() => {
                                testTranslationApiConfig();
                            }}
                        >
                            {t('dialog.translation_api.test')}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        disabled={integrationStatus.translation === 'running'}
                        onClick={() => {
                            saveTranslationApiConfig();
                        }}
                    >
                        {t('dialog.translation_api.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function normalizeReasoningEffortForModel(
    endpoint: LlmEndpointDto | null,
    modelId: string,
    currentEffort: string,
    setDraftValue: (key: 'translationAPIReasoningEffort', value: string) => void
): void {
    if (!currentEffort.trim()) {
        return;
    }
    const reasoning = getModelReasoning(endpoint, modelId);
    const effective = getEffectiveReasoningEffort(currentEffort, reasoning);
    if (effective === null) {
        setDraftValue('translationAPIReasoningEffort', '');
    }
}
