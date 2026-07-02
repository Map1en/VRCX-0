import { useTranslation } from 'react-i18next';

import { getLanguageName, languageCodes } from '@/localization/index';
import type { LlmEndpointDto } from '@/platform/tauri/bindings';
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
    SelectLabel,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';

import { DEFAULT_TRANSLATION_MODEL } from '../../settingsValues';
import { Field, FieldGroup } from '../SettingsField';

type TranslationDraft = {
    bioLanguage: string;
    translationAPIType: string;
    translationAPIKey: string;
    translationEndpointId: string;
    translationAPIEndpoint: string;
    translationAPIModel: string;
    translationAPIPrompt: string;
};

type TranslationProviderOption = readonly [value: string, labelKey: string];

type TranslationApiDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    draft: TranslationDraft;
    onDraftValueChange: (key: keyof TranslationDraft, value: string) => void;
    providerOptions: readonly TranslationProviderOption[];
    llmEndpoints: LlmEndpointDto[];
    integrationStatus: {
        translation: string;
        models: string;
    };
    onFetchModels: (endpointId?: string) => void | Promise<void>;
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
    onFetchModels: fetchTranslationModels,
    onTest: testTranslationApiConfig,
    onSave: saveTranslationApiConfig
}: TranslationApiDialogProps) {
    const { t } = useTranslation();
    const translationProvider = translationDraft.translationAPIType;
    const endpoints = llmEndpoints;
    const selectedEndpoint = endpoints.find(
        (endpoint) => endpoint.id === translationDraft.translationEndpointId
    );
    const modelOptions = selectedEndpoint?.models ?? [];
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
                                setTranslationDraftValue('bioLanguage', value)
                            }
                        >
                            <SelectTrigger
                                id="settings-translation-bio-language"
                                className="w-56"
                            >
                                <SelectValue />
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
                            onValueChange={(value) => {
                                setTranslationDraftValue(
                                    'translationAPIType',
                                    value
                                );
                                if (
                                    value === 'openai' &&
                                    translationDraft.translationEndpointId
                                ) {
                                    fetchTranslationModels(
                                        translationDraft.translationEndpointId
                                    );
                                }
                            }}
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
                                        ([value, labelKey]) => (
                                            <SelectItem
                                                key={value}
                                                value={value}
                                            >
                                                {t(labelKey)}
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
                                label={t(
                                    'dialog.translation_api.openai.connection'
                                )}
                                description={t(
                                    'dialog.translation_api.openai.connection_description'
                                )}
                                controlId="settings-translation-endpoint-id"
                            >
                                <Select
                                    value={
                                        translationDraft.translationEndpointId ||
                                        undefined
                                    }
                                    disabled={!endpoints.length}
                                    onValueChange={(value) => {
                                        setTranslationDraftValue(
                                            'translationEndpointId',
                                            value
                                        );
                                        const endpoint = endpoints.find(
                                            (item) => item.id === value
                                        );
                                        if (
                                            endpoint?.models.length &&
                                            !endpoint.models.includes(
                                                translationDraft.translationAPIModel
                                            )
                                        ) {
                                            setTranslationDraftValue(
                                                'translationAPIModel',
                                                endpoint.models[0]
                                            );
                                        }
                                        fetchTranslationModels(value);
                                    }}
                                >
                                    <SelectTrigger
                                        id="settings-translation-endpoint-id"
                                        className="w-96 max-w-full"
                                    >
                                        <SelectValue
                                            placeholder={t(
                                                'dialog.translation_api.openai.connection_placeholder'
                                            )}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {endpoints.map((endpoint) => (
                                                <SelectItem
                                                    key={endpoint.id}
                                                    value={endpoint.id}
                                                >
                                                    {endpoint.name}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field
                                label={t('dialog.translation_api.openai.model')}
                                controlId="settings-translation-model"
                            >
                                {modelOptions.length ? (
                                    <Select
                                        value={
                                            translationDraft.translationAPIModel ||
                                            modelOptions[0]
                                        }
                                        onValueChange={(value) =>
                                            setTranslationDraftValue(
                                                'translationAPIModel',
                                                value
                                            )
                                        }
                                        onOpenChange={(open) => {
                                            if (
                                                open &&
                                                selectedEndpoint &&
                                                integrationStatus.models !==
                                                    'running'
                                            ) {
                                                fetchTranslationModels(
                                                    selectedEndpoint.id
                                                );
                                            }
                                        }}
                                    >
                                        <SelectTrigger
                                            id="settings-translation-model"
                                            className="w-96 max-w-full"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {selectedEndpoint?.name ? (
                                                    <SelectLabel>
                                                        {selectedEndpoint.name}
                                                    </SelectLabel>
                                                ) : null}
                                                {modelOptions.map(
                                                    (model: string) => (
                                                        <SelectItem
                                                            key={model}
                                                            value={model}
                                                        >
                                                            {model}
                                                        </SelectItem>
                                                    )
                                                )}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Input
                                        id="settings-translation-model"
                                        name="translationApiModel"
                                        value={
                                            translationDraft.translationAPIModel
                                        }
                                        placeholder={DEFAULT_TRANSLATION_MODEL}
                                        className="w-96 max-w-full"
                                        onChange={(event) =>
                                            setTranslationDraftValue(
                                                'translationAPIModel',
                                                event.target.value
                                            )
                                        }
                                    />
                                )}
                            </Field>
                            <Field
                                label={t(
                                    'dialog.translation_api.openai.prompt_optional'
                                )}
                                description={t(
                                    'dialog.translation_api.openai.prompt_optional_description'
                                )}
                                controlId="settings-translation-prompt"
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
                                    className="w-96 max-w-full resize-none"
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
                                type="password"
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
