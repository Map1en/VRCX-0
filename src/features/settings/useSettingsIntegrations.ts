import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import type { RuntimeModelRef } from '@/features/assistant/components/RuntimeModelSelect';
import { languageCodes } from '@/localization/index';
import {
    commands,
    type AssistantRuntimeStatus,
    type LlmEndpointDto
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import {
    setDiscordBoolPreference,
    setTranslationApiConfigPreference,
    setYoutubeApiKeyPreference
} from '@/services/preferencesService';
import { toast } from '@/services/toastService';
import { isRecord } from '@/shared/utils/record';
import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import {
    normalizeTranslationApiType,
    type DiscordPreferenceKey,
    type TranslationApiType,
    usePreferencesStore
} from '@/state/preferencesStore';

import {
    getEffectiveReasoningEffort,
    getModelReasoning,
    isOpenRouterBaseUrl
} from '../llm/reasoning';
import { parseWebJson } from './settingsValues';

export type SettingsIntegrationPrefs = {
    youtubeAPI: boolean;
    youtubeAPIKey: string;
    translationAPI: boolean;
    bioLanguage: string;
    translationAPIType: TranslationApiType;
    translationAPIKey: string;
    translationEndpointId: string;
    translationAPIModel: string;
    translationAPIPrompt: string;
    translationAPIReasoningEffort: string;
    [key: string]: unknown;
};

type SettingsIntegrationValueKey =
    | 'youtubeAPI'
    | 'youtubeAPIKey'
    | 'translationAPI'
    | 'translationAPIKey'
    | 'bioLanguage'
    | 'translationAPIType'
    | 'translationEndpointId'
    | 'translationAPIModel'
    | 'translationAPIPrompt'
    | 'translationAPIReasoningEffort';

export type SettingsDiscordPrefs = {
    discordActive: boolean;
    discordInstance: boolean;
    discordHideInvite: boolean;
    discordJoinButton: boolean;
    discordHideImage: boolean;
    discordShowPlatform: boolean;
    discordWorldIntegration: boolean;
    discordWorldNameAsDiscordStatus: boolean;
    [key: string]: unknown;
};

type SettingsIntegrationStatus = {
    youtube: string;
    translation: string;
    [key: string]: unknown;
};

type SettingsTranslationDraft = {
    bioLanguage: string;
    translationAPIType: TranslationApiType;
    translationAPIKey: string;
    translationEndpointId: string;
    translationAPIModel: string;
    translationAPIPrompt: string;
    translationAPIReasoningEffort: string;
    [key: string]: unknown;
};

type PreferenceAction = () => void;
type PreferenceRollback = void | (() => void);
type SettingsIntegrationsDeps = {
    commit: (
        action: PreferenceAction,
        optimistic?: () => PreferenceRollback
    ) => Promise<boolean>;
};

export function useSettingsIntegrations({ commit }: SettingsIntegrationsDeps) {
    const { t } = useTranslation();
    const llmEndpoints = useLlmEndpointsStore((state) => state.endpoints);
    const integrationPreferenceValues = usePreferencesStore(
        useShallow((state) => ({
            youtubeAPI: state.youtubeAPI,
            translationAPI: state.translationAPI,
            bioLanguage: state.bioLanguage,
            translationAPIType: state.translationAPIType,
            translationEndpointId: state.translationEndpointId,
            translationAPIModel: state.translationAPIModel,
            translationAPIPrompt: state.translationAPIPrompt,
            translationAPIReasoningEffort: state.translationAPIReasoningEffort
        }))
    );
    const discordPrefs = usePreferencesStore(
        useShallow((state) => ({
            discordActive: state.discordActive,
            discordInstance: state.discordInstance,
            discordHideInvite: state.discordHideInvite,
            discordJoinButton: state.discordJoinButton,
            discordHideImage: state.discordHideImage,
            discordShowPlatform: state.discordShowPlatform,
            discordWorldIntegration: state.discordWorldIntegration,
            discordWorldNameAsDiscordStatus:
                state.discordWorldNameAsDiscordStatus
        }))
    );
    const [integrationApiKeys, setIntegrationApiKeys] = useState({
        youtubeAPIKey: '',
        translationAPIKey: ''
    });
    const integrationPrefs = useMemo<SettingsIntegrationPrefs>(
        () => ({
            ...integrationPreferenceValues,
            ...integrationApiKeys
        }),
        [integrationApiKeys, integrationPreferenceValues]
    );
    const [integrationStatus, setIntegrationStatus] =
        useState<SettingsIntegrationStatus>({
            youtube: 'idle',
            translation: 'idle'
        });
    const [youtubeApiDialogOpen, setYoutubeApiDialogOpen] = useState(false);
    const [youtubeApiKeyDraft, setYoutubeApiKeyDraft] = useState('');
    const [translationApiDialogOpen, setTranslationApiDialogOpen] =
        useState(false);
    const [translationDraft, setTranslationDraft] =
        useState<SettingsTranslationDraft>({
            bioLanguage: 'en',
            translationAPIType: 'google',
            translationAPIKey: '',
            translationEndpointId: '',
            translationAPIModel: '',
            translationAPIPrompt: '',
            translationAPIReasoningEffort: ''
        });
    const [translationDefaultModel, setTranslationDefaultModel] = useState<
        RuntimeModelRef | null | undefined
    >(undefined);

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('youtubeAPIKey', ''),
            configRepository.getString('translationAPIKey', '')
        ])
            .then(([youtubeAPIKey, translationAPIKey]) => {
                if (!active) {
                    return;
                }
                setIntegrationApiKeys((current) => ({
                    ...current,
                    youtubeAPIKey: youtubeAPIKey || '',
                    translationAPIKey: translationAPIKey || ''
                }));
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    function setIntegrationValue(
        key: SettingsIntegrationValueKey,
        value: unknown
    ) {
        if (key === 'youtubeAPIKey' || key === 'translationAPIKey') {
            setIntegrationApiKeys((current) => ({
                ...current,
                [key]: String(value ?? '')
            }));
            return;
        }
        if (key === 'youtubeAPI' || key === 'translationAPI') {
            usePreferencesStore
                .getState()
                .setPreferenceValue(key, value === true);
            return;
        }
        usePreferencesStore
            .getState()
            .setPreferenceValue(key, String(value ?? ''));
    }

    function setTranslationDraftValue(
        key: keyof SettingsTranslationDraft,
        value: string
    ) {
        setTranslationDraft((current) => ({ ...current, [key]: value }));
    }

    function openYoutubeApiDialog() {
        setYoutubeApiKeyDraft(integrationPrefs.youtubeAPIKey || '');
        setYoutubeApiDialogOpen(true);
    }

    async function loadTranslationDefaultModel() {
        const status = await commands.appAssistantRuntimeStatus();
        const defaultModel = defaultModelFromStatus(status);
        setTranslationDefaultModel(defaultModel);
        return defaultModel;
    }

    function openTranslationApiDialog() {
        useLlmEndpointsStore
            .getState()
            .load()
            .catch(() => {});
        setTranslationDefaultModel(undefined);
        loadTranslationDefaultModel().catch(() => {});
        const assignment = translationAssignment({
            translationEndpointId: integrationPrefs.translationEndpointId || '',
            translationAPIModel: integrationPrefs.translationAPIModel || ''
        });
        const nextDraft = {
            bioLanguage: integrationPrefs.bioLanguage || 'en',
            translationAPIType: normalizeTranslationApiType(
                integrationPrefs.translationAPIType
            ),
            translationAPIKey: integrationPrefs.translationAPIKey || '',
            translationEndpointId: assignment?.endpointId ?? '',
            translationAPIModel: assignment?.model ?? '',
            translationAPIPrompt: integrationPrefs.translationAPIPrompt || '',
            translationAPIReasoningEffort:
                integrationPrefs.translationAPIReasoningEffort || ''
        };
        setTranslationDraft(nextDraft);
        setTranslationApiDialogOpen(true);
    }

    async function resolveTranslationModel(
        provider: TranslationApiType,
        assignment: RuntimeModelRef | null
    ): Promise<RuntimeModelRef | null | undefined> {
        if (provider !== 'openai' || assignment) {
            return assignment;
        }
        const defaultModel = await loadTranslationDefaultModel().catch(
            () => null
        );
        if (!defaultModel) {
            toast.add({
                type: 'warning',
                title: t('dialog.translation_api.msg_no_default_model')
            });
            return undefined;
        }
        return defaultModel;
    }

    function setDiscordValue(key: DiscordPreferenceKey, value: boolean) {
        usePreferencesStore.getState().patchPreferences({ [key]: value });
    }

    async function saveDiscordBoolPreference(
        key: DiscordPreferenceKey,
        value: boolean
    ) {
        await commit(
            () => setDiscordBoolPreference(key, value),
            () => {
                const previous = discordPrefs[key];
                setDiscordValue(key, value);
                return () => setDiscordValue(key, previous);
            }
        );
    }

    async function validateYoutubeApiKey(apiKey: string) {
        if (!apiKey) {
            return;
        }
        const response = await commands.appExternalApiYoutubeVideoMetadataGet({
            videoId: 'dQw4w9WgXcQ',
            apiKey: apiKey.trim()
        });
        const payload = parseWebJson(response);
        const items = isRecord(payload) ? payload.items : null;
        if (
            response.status !== 200 ||
            !Array.isArray(items) ||
            items.length === 0
        ) {
            throw new Error(t('dialog.youtube_api.msg_test_failed'));
        }
    }

    async function saveYoutubeApiKey() {
        const apiKey = youtubeApiKeyDraft.trim();
        setIntegrationStatus((current) => ({
            ...current,
            youtube: 'running'
        }));
        try {
            await validateYoutubeApiKey(apiKey);
            await setYoutubeApiKeyPreference(apiKey);
            setIntegrationApiKeys((current) => ({
                ...current,
                youtubeAPIKey: apiKey
            }));
            toast.add({
                type: 'success',
                title: apiKey
                    ? t('dialog.youtube_api.msg_settings_saved')
                    : t('dialog.youtube_api.msg_removed')
            });
            setYoutubeApiDialogOpen(false);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.youtube_api.msg_test_failed')
            });
        } finally {
            setIntegrationStatus((current) => ({
                ...current,
                youtube: 'idle'
            }));
        }
    }

    async function saveTranslationApiConfig() {
        const nextType = normalizeTranslationApiType(
            translationDraft.translationAPIType
        );
        const assignment = translationAssignment(translationDraft);
        const nextKey = translationDraft.translationAPIKey.trim();
        const nextBioLanguage = languageCodes.includes(
            translationDraft.bioLanguage
        )
            ? translationDraft.bioLanguage
            : 'en';
        const resolvedModel = await resolveTranslationModel(
            nextType,
            assignment
        );
        if (resolvedModel === undefined) {
            return;
        }

        const nextReasoningEffort = normalizeTranslationReasoningEffort(
            translationDraft.translationAPIReasoningEffort,
            nextType,
            llmEndpoints,
            resolvedModel
        );

        setIntegrationStatus((current) => ({
            ...current,
            translation: 'running'
        }));
        try {
            const savedConfig = await setTranslationApiConfigPreference({
                bioLanguage: nextBioLanguage,
                translationAPIType: nextType,
                translationAPIKey: nextKey,
                translationEndpointId: assignment?.endpointId ?? '',
                translationAPIModel: assignment?.model ?? '',
                translationAPIPrompt: translationDraft.translationAPIPrompt,
                translationAPIReasoningEffort: nextReasoningEffort
            });
            setIntegrationApiKeys((current) => ({
                ...current,
                translationAPIKey: savedConfig.translationAPIKey
            }));
            toast.add({
                type: 'success',
                title: t('dialog.translation_api.msg_settings_saved')
            });
            setTranslationApiDialogOpen(false);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.settings.toast.failed_to_save_translation_settings'
                          )
            });
        } finally {
            setIntegrationStatus((current) => ({
                ...current,
                translation: 'idle'
            }));
        }
    }

    async function testTranslationApiConfig() {
        const provider = normalizeTranslationApiType(
            translationDraft.translationAPIType
        );
        const apiKey = translationDraft.translationAPIKey.trim();
        if (provider === 'google' && !apiKey) {
            toast.add({
                type: 'warning',
                title: t('dialog.translation_api.description')
            });
            return;
        }
        if (provider === 'deepl' && !apiKey) {
            toast.add({
                type: 'warning',
                title: t('dialog.translation_api.deepl.api_key')
            });
            return;
        }
        const assignment = translationAssignment(translationDraft);
        const resolvedModel = await resolveTranslationModel(
            provider,
            assignment
        );
        if (resolvedModel === undefined) {
            return;
        }
        const reasoningEffort = normalizeTranslationReasoningEffort(
            translationDraft.translationAPIReasoningEffort,
            provider,
            llmEndpoints,
            resolvedModel
        );
        setIntegrationStatus((current) => ({
            ...current,
            translation: 'running'
        }));
        try {
            const result = await commands.appTranslationTranslate({
                text: 'Hello world',
                targetLanguage: translationDraft.bioLanguage || 'en',
                overrides: {
                    enabled: true,
                    apiType: provider,
                    key: apiKey,
                    endpointId: assignment?.endpointId ?? '',
                    model: assignment?.model ?? '',
                    prompt: translationDraft.translationAPIPrompt || null,
                    reasoningEffort: reasoningEffort || null
                }
            });
            if (!result.text.trim()) {
                throw new Error(t('dialog.translation_api.msg_test_failed'));
            }
            toast.add({
                type: 'success',
                title: t('dialog.translation_api.msg_test_success')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.translation_api.msg_test_failed')
            });
        } finally {
            setIntegrationStatus((current) => ({
                ...current,
                translation: 'idle'
            }));
        }
    }

    return {
        discordPrefs,
        integrationPrefs,
        integrationStatus,
        llmEndpoints,
        openTranslationApiDialog,
        openYoutubeApiDialog,
        saveDiscordBoolPreference,
        saveTranslationApiConfig,
        saveYoutubeApiKey,
        setIntegrationValue,
        setTranslationApiDialogOpen,
        setTranslationDraftValue,
        setYoutubeApiDialogOpen,
        setYoutubeApiKeyDraft,
        testTranslationApiConfig,
        translationApiDialogOpen,
        translationDefaultModel,
        translationDraft,
        youtubeApiDialogOpen,
        youtubeApiKeyDraft
    };
}

function translationAssignment(draft: {
    translationEndpointId: string;
    translationAPIModel: string;
}): RuntimeModelRef | null {
    const endpointId = draft.translationEndpointId.trim();
    const model = draft.translationAPIModel.trim();
    return endpointId && model ? { endpointId, model } : null;
}

function defaultModelFromStatus(
    status: AssistantRuntimeStatus
): RuntimeModelRef | null {
    const { endpointId, model } = status.lastSelection;
    return endpointId && model ? { endpointId, model } : null;
}

function normalizeTranslationReasoningEffort(
    effort: string,
    apiType: string,
    endpoints: LlmEndpointDto[],
    resolvedModel: RuntimeModelRef | null
): string {
    if (apiType !== 'openai' || !effort || !resolvedModel) {
        return '';
    }
    const endpoint = endpoints.find((ep) => ep.id === resolvedModel.endpointId);
    if (!endpoint || !isOpenRouterBaseUrl(endpoint.baseUrl)) {
        return '';
    }
    const reasoning = getModelReasoning(endpoint, resolvedModel.model);
    return getEffectiveReasoningEffort(effort, reasoning) ?? '';
}
