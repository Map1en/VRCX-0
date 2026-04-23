import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { openExternalLink } from '@/lib/entityMedia.js';
import { getLanguageName, languageCodes } from '@/localization/index.js';
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

import { Field, FieldGroup } from '../SettingsField.jsx';
import {
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL
} from '../../settingsValues.js';

export function TranslationApiDialog({
    t,
    open: translationApiDialogOpen,
    onOpenChange: setTranslationApiDialogOpen,
    draft: translationDraft,
    onDraftValueChange: setTranslationDraftValue,
    providerOptions: translationProviderOptions,
    availableModels: availableTranslationModels,
    integrationStatus,
    onFetchModels: fetchTranslationModels,
    onTest: testTranslationApiConfig,
    onSave: saveTranslationApiConfig
}) {
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
                                        value
                                    )
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
                                        {languageCodes.map((code) => (
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
                                onValueChange={(value) =>
                                    setTranslationDraftValue(
                                        'translationAPIType',
                                        value
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
                                        'dialog.translation_api.openai.endpoint'
                                    )}
                                    controlId="settings-translation-endpoint"
                                >
                                    <Input
                                        id="settings-translation-endpoint"
                                        value={
                                            translationDraft.translationAPIEndpoint
                                        }
                                        name="translationApiEndpoint"
                                        placeholder={
                                            DEFAULT_TRANSLATION_ENDPOINT
                                        }
                                        onChange={(event) =>
                                            setTranslationDraftValue(
                                                'translationAPIEndpoint',
                                                event.target.value
                                            )
                                        }
                                        className="w-96 max-w-full"
                                    />
                                </Field>
                                <Field
                                    label={t(
                                        'dialog.translation_api.openai.model'
                                    )}
                                    controlId="settings-translation-model"
                                >
                                    <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                                        {availableTranslationModels.length ? (
                                            <Select
                                                value={
                                                    translationDraft.translationAPIModel ||
                                                    availableTranslationModels[0]
                                                }
                                                onValueChange={(value) =>
                                                    setTranslationDraftValue(
                                                        'translationAPIModel',
                                                        value
                                                    )
                                                }
                                            >
                                                <SelectTrigger
                                                    id="settings-translation-model"
                                                    className="min-w-56"
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {availableTranslationModels.map(
                                                            (model) => (
                                                                <SelectItem
                                                                    key={model}
                                                                    value={
                                                                        model
                                                                    }
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
                                                placeholder={
                                                    DEFAULT_TRANSLATION_MODEL
                                                }
                                                onChange={(event) =>
                                                    setTranslationDraftValue(
                                                        'translationAPIModel',
                                                        event.target.value
                                                    )
                                                }
                                            />
                                        )}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={
                                                integrationStatus.models ===
                                                'running'
                                            }
                                            onClick={() =>
                                                void fetchTranslationModels()
                                            }
                                        >
                                            {integrationStatus.models ===
                                            'running'
                                                ? t(
                                                      'dialog.translation_api.fetching_models'
                                                  )
                                                : t(
                                                      'dialog.translation_api.fetch_models'
                                                  )}
                                        </Button>
                                    </div>
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
                        <Field
                            label={
                                translationDraft.translationAPIType === 'openai'
                                    ? t('dialog.translation_api.openai.api_key')
                                    : t('dialog.translation_api.description')
                            }
                            controlId="settings-translation-api-key"
                        >
                            <Input
                                id="settings-translation-api-key"
                                type="password"
                                name="translationApiKey"
                                value={translationDraft.translationAPIKey}
                                placeholder={
                                    translationDraft.translationAPIType ===
                                    'openai'
                                        ? 'sk-...'
                                        : 'AIzaSy...'
                                }
                                onChange={(event) =>
                                    setTranslationDraftValue(
                                        'translationAPIKey',
                                        event.target.value
                                    )
                                }
                                className="w-96 max-w-full"
                            />
                        </Field>
                    </FieldGroup>
                    <DialogFooter>
                        {translationDraft.translationAPIType === 'google' ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                    void openExternalLink(
                                        'https://translatepress.com/docs/automatic-translation/generate-google-api-key/'
                                    )
                                }
                            >
                                {t('dialog.translation_api.guide')}
                            </Button>
                        ) : null}
                        {translationDraft.translationAPIType === 'openai' ? (
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    integrationStatus.translation === 'running'
                                }
                                onClick={() => void testTranslationApiConfig()}
                            >
                                {t('dialog.translation_api.test')}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            disabled={
                                integrationStatus.translation === 'running'
                            }
                            onClick={() => void saveTranslationApiConfig()}
                        >
                            {t('dialog.translation_api.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
    );
}
