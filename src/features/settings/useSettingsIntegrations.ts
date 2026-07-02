import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { languageCodes } from '@/localization/index';
import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import externalApiRepository from '@/repositories/externalApiRepository';
import {
    setDiscordBoolPreference,
    setTranslationApiConfigPreference,
    setYoutubeApiKeyPreference
} from '@/services/preferencesService';
import { normalizeDeepLTargetLanguage } from '@/services/translationService';
import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import {
    normalizeTranslationApiType,
    type DiscordPreferenceKey
} from '@/state/preferencesStore';

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
    translationAPIType: string;
    translationAPIKey: string;
    translationEndpointId: string;
    translationAPIEndpoint: string;
    translationAPIModel: string;
    translationAPIPrompt: string;
    [key: string]: unknown;
};

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
    translationAPIType: string;
    translationAPIKey: string;
    translationEndpointId: string;
    translationAPIEndpoint: string;
    translationAPIModel: string;
    translationAPIPrompt: string;
    [key: string]: unknown;
};

type PreferenceAction = () => unknown | Promise<unknown>;
type PreferenceRollback = void | (() => void);
type SettingsIntegrationsDeps = {
    commit: (
        action: PreferenceAction,
        optimistic?: () => PreferenceRollback
    ) => Promise<boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function useSettingsIntegrations({ commit }: SettingsIntegrationsDeps) {
    const { t } = useTranslation();
    const llmEndpoints = useLlmEndpointsStore((state) => state.endpoints);
    const [integrationPrefs, setIntegrationPrefs] =
        useState<SettingsIntegrationPrefs>({
            youtubeAPI: false,
            youtubeAPIKey: '',
            translationAPI: false,
            bioLanguage: 'en',
            translationAPIType: 'google',
            translationAPIKey: '',
            translationEndpointId: '',
            translationAPIEndpoint: DEFAULT_TRANSLATION_ENDPOINT,
            translationAPIModel: DEFAULT_TRANSLATION_MODEL,
            translationAPIPrompt: ''
        });
    const [discordPrefs, setDiscordPrefs] = useState<SettingsDiscordPrefs>({
        discordActive: false,
        discordInstance: true,
        discordHideInvite: true,
        discordJoinButton: false,
        discordHideImage: false,
        discordShowPlatform: true,
        discordWorldIntegration: true,
        discordWorldNameAsDiscordStatus: false
    });
    const fetchingModelsRef = useRef(false);
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
            translationAPIPrompt: ''
        });

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
                setIntegrationPrefs((current) => ({
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
        key: keyof SettingsIntegrationPrefs,
        value: unknown
    ) {
        setIntegrationPrefs((current) => ({ ...current, [key]: value }));
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
        setTranslationDraft({
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
            translationAPIPrompt: integrationPrefs.translationAPIPrompt || ''
        });
        setTranslationApiDialogOpen(true);
    }

    function setDiscordValue(key: DiscordPreferenceKey, value: boolean) {
        setDiscordPrefs((current) => ({ ...current, [key]: value }));
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
        const response = await externalApiRepository.fetchYoutubeVideoMetadata({
            videoId: 'dQw4w9WgXcQ',
            apiKey
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
            setIntegrationPrefs((current) => ({
                ...current,
                youtubeAPIKey: apiKey
            }));
            toast.success(
                apiKey
                    ? t('dialog.youtube_api.msg_settings_saved')
                    : t('dialog.youtube_api.msg_removed')
            );
            setYoutubeApiDialogOpen(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.youtube_api.msg_test_failed')
            );
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
            toast.warning(t('dialog.translation_api.msg_fill_endpoint_model'));
            return;
        }

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
                translationAPIPrompt: translationDraft.translationAPIPrompt
            });
            setIntegrationPrefs((current) => ({
                ...current,
                ...savedConfig
            }));
            toast.success(t('dialog.translation_api.msg_settings_saved'));
            setTranslationApiDialogOpen(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.settings.toast.failed_to_save_translation_settings'
                      )
            );
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
        if (!endpointId || fetchingModelsRef.current) {
            return;
        }

        fetchingModelsRef.current = true;
        setIntegrationStatus((current) => ({
            ...current,
            models: 'running'
        }));
        try {
            const models = await useLlmEndpointsStore.getState().detectModels({
                id: endpointId,
                baseUrl: null,
                apiKey: null,
                persist: true
            });
            if (
                models.length &&
                !models.includes(translationDraft.translationAPIModel.trim())
            ) {
                setTranslationDraftValue('translationAPIModel', models[0]);
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.settings.toast.failed_to_fetch_translation_models'
                      )
            );
        } finally {
            fetchingModelsRef.current = false;
            setIntegrationStatus((current) => ({
                ...current,
                models: 'idle'
            }));
        }
    }

    async function testTranslationApiConfig() {
        const provider = normalizeTranslationApiType(
            translationDraft.translationAPIType
        );
        const apiKey = translationDraft.translationAPIKey.trim();
        setIntegrationStatus((current) => ({
            ...current,
            translation: 'running'
        }));
        try {
            if (provider === 'google') {
                if (!apiKey) {
                    toast.warning(t('dialog.translation_api.description'));
                    return;
                }
                const response =
                    await externalApiRepository.executeTranslationRequest({
                        url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            q: 'Hello world',
                            target: translationDraft.bioLanguage || 'en',
                            format: 'text'
                        })
                    });
                if (response.status !== 200) {
                    throw new Error(
                        t('dialog.translation_api.msg_test_failed')
                    );
                }
            } else if (provider === 'deepl') {
                if (!apiKey) {
                    toast.warning(t('dialog.translation_api.deepl.api_key'));
                    return;
                }
                const response =
                    await externalApiRepository.executeTranslationRequest({
                        url: 'https://api-free.deepl.com/v2/translate',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `DeepL-Auth-Key ${apiKey}`
                        },
                        body: JSON.stringify({
                            text: ['Hello world'],
                            target_lang: normalizeDeepLTargetLanguage(
                                translationDraft.bioLanguage || 'en'
                            )
                        })
                    });
                if (response.status !== 200) {
                    throw new Error(
                        t('dialog.translation_api.msg_test_failed')
                    );
                }
            } else {
                const endpointId =
                    translationDraft.translationEndpointId.trim();
                const model =
                    translationDraft.translationAPIModel.trim() ||
                    DEFAULT_TRANSLATION_MODEL;
                if (!endpointId || !model) {
                    toast.warning(
                        t('dialog.translation_api.msg_fill_endpoint_model')
                    );
                    return;
                }
                const translated = await commands.appLlmTranslate({
                    endpointId,
                    model,
                    text: 'Hello world',
                    targetLang: translationDraft.bioLanguage || 'en',
                    prompt: translationDraft.translationAPIPrompt || null
                });
                if (!translated.trim()) {
                    throw new Error(
                        t('dialog.translation_api.msg_test_failed')
                    );
                }
            }
            toast.success(t('dialog.translation_api.msg_test_success'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.translation_api.msg_test_failed')
            );
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
        setDiscordPrefs,
        setIntegrationPrefs,
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
