import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { languageCodes } from '@/localization/index';
import { commands, type LlmEndpointDto } from '@/platform/tauri/bindings';
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
import {
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL,
    parseWebJson
} from './settingsValues';

export type SettingsIntegrationPrefs = {
    youtubeAPI: boolean;
    youtubeAPIKey: string;
    translationAPI: boolean;
    bioLanguage: string;
    translationAPIType: TranslationApiType;
    translationAPIKey: string;
    translationEndpointId: string;
    translationAPIEndpoint: string;
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
    | 'translationAPIEndpoint'
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
    models: string;
    [key: string]: unknown;
};

type SettingsTranslationDraft = {
    bioLanguage: string;
    translationAPIType: TranslationApiType;
    translationAPIKey: string;
    translationEndpointId: string;
    translationAPIEndpoint: string;
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
            translationAPIEndpoint: state.translationAPIEndpoint,
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
    const fetchingModelsRef = useRef(new Set<string>());
    const [integrationStatus, setIntegrationStatus] =
        useState<SettingsIntegrationStatus>({
            youtube: 'idle',
            translation: 'idle',
            models: 'idle'
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
            translationAPIEndpoint: DEFAULT_TRANSLATION_ENDPOINT,
            translationAPIModel: DEFAULT_TRANSLATION_MODEL,
            translationAPIPrompt: '',
            translationAPIReasoningEffort: ''
        });
    const translationDraftRef = useRef(translationDraft);

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
        translationDraftRef.current = {
            ...translationDraftRef.current,
            [key]: value
        };
        setTranslationDraft((current) => ({ ...current, [key]: value }));
    }

    function openYoutubeApiDialog() {
        setYoutubeApiKeyDraft(integrationPrefs.youtubeAPIKey || '');
        setYoutubeApiDialogOpen(true);
    }

    function openTranslationApiDialog() {
        useLlmEndpointsStore
            .getState()
            .load()
            .then((endpoints) => {
                const selected =
                    integrationPrefs.translationEndpointId ||
                    endpoints[0]?.id ||
                    '';
                if (selected) {
                    setTranslationDraftValue('translationEndpointId', selected);
                    if (
                        normalizeTranslationApiType(
                            integrationPrefs.translationAPIType
                        ) === 'openai'
                    ) {
                        fetchTranslationModels(selected);
                    }
                }
            })
            .catch(() => {});
        const nextDraft = {
            bioLanguage: integrationPrefs.bioLanguage || 'en',
            translationAPIType: normalizeTranslationApiType(
                integrationPrefs.translationAPIType
            ),
            translationAPIKey: integrationPrefs.translationAPIKey || '',
            translationEndpointId: integrationPrefs.translationEndpointId || '',
            translationAPIEndpoint:
                integrationPrefs.translationAPIEndpoint ||
                DEFAULT_TRANSLATION_ENDPOINT,
            translationAPIModel:
                integrationPrefs.translationAPIModel ||
                DEFAULT_TRANSLATION_MODEL,
            translationAPIPrompt: integrationPrefs.translationAPIPrompt || '',
            translationAPIReasoningEffort:
                integrationPrefs.translationAPIReasoningEffort || ''
        };
        translationDraftRef.current = nextDraft;
        setTranslationDraft(nextDraft);
        setTranslationApiDialogOpen(true);
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
        const nextEndpoint =
            translationDraft.translationAPIEndpoint.trim() ||
            DEFAULT_TRANSLATION_ENDPOINT;
        const nextModel =
            translationDraft.translationAPIModel.trim() ||
            DEFAULT_TRANSLATION_MODEL;
        const nextEndpointId = translationDraft.translationEndpointId.trim();
        const nextKey = translationDraft.translationAPIKey.trim();
        const nextBioLanguage = languageCodes.includes(
            translationDraft.bioLanguage
        )
            ? translationDraft.bioLanguage
            : 'en';
        if (nextType === 'openai' && (!nextEndpointId || !nextModel)) {
            toast.add({
                type: 'warning',
                title: t('dialog.translation_api.msg_fill_endpoint_model')
            });
            return;
        }

        const nextReasoningEffort = normalizeTranslationReasoningEffort(
            translationDraft.translationAPIReasoningEffort,
            nextType,
            llmEndpoints,
            nextEndpointId,
            nextModel
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
                translationEndpointId: nextEndpointId,
                translationAPIEndpoint: nextEndpoint,
                translationAPIModel: nextModel,
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

    async function fetchTranslationModels(endpointIdOverride?: string) {
        const endpointId = (
            endpointIdOverride ?? translationDraft.translationEndpointId
        ).trim();
        if (!endpointId || fetchingModelsRef.current.has(endpointId)) {
            return;
        }
        fetchingModelsRef.current.add(endpointId);
        setIntegrationStatus((current) => ({
            ...current,
            models: 'running'
        }));
        try {
            const endpoints = await useLlmEndpointsStore.getState().load();
            const endpoint = endpoints.find((item) => item.id === endpointId);
            if (!endpoint) {
                return;
            }
            const currentDraft = translationDraftRef.current;
            if (currentDraft.translationEndpointId.trim() !== endpointId) {
                return;
            }
            const currentModel = currentDraft.translationAPIModel.trim();
            const nextModel =
                endpoint.models.length > 0 &&
                !endpoint.models.includes(currentModel)
                    ? endpoint.models[0]
                    : currentModel;
            if (nextModel !== currentModel) {
                setTranslationDraftValue('translationAPIModel', nextModel);
            }
            const currentEffort =
                translationDraftRef.current.translationAPIReasoningEffort;
            const effective = getEffectiveReasoningEffort(
                currentEffort,
                getModelReasoning(endpoint, nextModel)
            );
            if (currentEffort && effective === null) {
                setTranslationDraftValue('translationAPIReasoningEffort', '');
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.settings.toast.failed_to_fetch_translation_models'
                          )
            });
        } finally {
            fetchingModelsRef.current.delete(endpointId);
            if (fetchingModelsRef.current.size === 0) {
                setIntegrationStatus((current) => ({
                    ...current,
                    models: 'idle'
                }));
            }
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
        const endpointId = translationDraft.translationEndpointId.trim();
        const model =
            translationDraft.translationAPIModel.trim() ||
            DEFAULT_TRANSLATION_MODEL;
        if (provider === 'openai') {
            if (!endpointId || !model) {
                toast.add({
                    type: 'warning',
                    title: t('dialog.translation_api.msg_fill_endpoint_model')
                });
                return;
            }
        }
        const reasoningEffort = normalizeTranslationReasoningEffort(
            translationDraft.translationAPIReasoningEffort,
            provider,
            llmEndpoints,
            endpointId,
            model
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
                    endpointId,
                    model,
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
        fetchTranslationModels,
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
        translationDraft,
        youtubeApiDialogOpen,
        youtubeApiKeyDraft
    };
}

function normalizeTranslationReasoningEffort(
    effort: string,
    apiType: string,
    endpoints: LlmEndpointDto[],
    endpointId: string,
    model: string
): string {
    if (apiType !== 'openai' || !effort) {
        return '';
    }
    const endpoint = endpoints.find((ep) => ep.id === endpointId);
    if (!endpoint || !isOpenRouterBaseUrl(endpoint.baseUrl)) {
        return '';
    }
    const reasoning = getModelReasoning(endpoint, model);
    return getEffectiveReasoningEffort(effort, reasoning) ?? '';
}
