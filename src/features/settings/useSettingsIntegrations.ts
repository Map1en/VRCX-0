import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { languageCodes } from '@/localization/index';
import configRepository from '@/repositories/configRepository';
import externalApiRepository from '@/repositories/externalApiRepository';
import {
    setDiscordBoolPreference,
    setTranslationApiConfigPreference,
    setYoutubeApiKeyPreference
} from '@/services/preferencesService';

import {
    buildOpenAiModelsEndpoint,
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL,
    parseWebJson
} from './settingsValues';

export function useSettingsIntegrations({ commit }: any) {
    const { t } = useTranslation();
    const [integrationPrefs, setIntegrationPrefs] = useState<any>({
        youtubeAPI: false,
        youtubeAPIKey: '',
        translationAPI: false,
        bioLanguage: 'en',
        translationAPIType: 'google',
        translationAPIKey: '',
        translationAPIEndpoint: DEFAULT_TRANSLATION_ENDPOINT,
        translationAPIModel: DEFAULT_TRANSLATION_MODEL,
        translationAPIPrompt: ''
    });
    const [discordPrefs, setDiscordPrefs] = useState<any>({
        discordActive: false,
        discordInstance: true,
        discordHideInvite: true,
        discordJoinButton: false,
        discordHideImage: false,
        discordShowPlatform: true,
        discordWorldIntegration: true,
        discordWorldNameAsDiscordStatus: false
    });
    const [availableTranslationModels, setAvailableTranslationModels] =
        useState<any[]>([]);
    const [integrationStatus, setIntegrationStatus] = useState<any>({
        youtube: 'idle',
        translation: 'idle',
        models: 'idle'
    });
    const [youtubeApiDialogOpen, setYoutubeApiDialogOpen] = useState(false);
    const [youtubeApiKeyDraft, setYoutubeApiKeyDraft] = useState('');
    const [translationApiDialogOpen, setTranslationApiDialogOpen] =
        useState(false);
    const [translationDraft, setTranslationDraft] = useState<any>({
        bioLanguage: 'en',
        translationAPIType: 'google',
        translationAPIKey: '',
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
            .then(([youtubeAPIKey, translationAPIKey]: any) => {
                if (!active) {
                    return;
                }
                setIntegrationPrefs((current: any) => ({
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

    function setIntegrationValue(key: any, value: any) {
        setIntegrationPrefs((current: any) => ({ ...current, [key]: value }));
    }

    function setTranslationDraftValue(key: any, value: any) {
        setTranslationDraft((current: any) => ({ ...current, [key]: value }));
    }

    function openYoutubeApiDialog() {
        setYoutubeApiKeyDraft(integrationPrefs.youtubeAPIKey || '');
        setYoutubeApiDialogOpen(true);
    }

    function openTranslationApiDialog() {
        setTranslationDraft({
            bioLanguage: integrationPrefs.bioLanguage || 'en',
            translationAPIType:
                integrationPrefs.translationAPIType === 'openai'
                    ? 'openai'
                    : 'google',
            translationAPIKey: integrationPrefs.translationAPIKey || '',
            translationAPIEndpoint:
                integrationPrefs.translationAPIEndpoint ||
                DEFAULT_TRANSLATION_ENDPOINT,
            translationAPIModel:
                integrationPrefs.translationAPIModel ||
                DEFAULT_TRANSLATION_MODEL,
            translationAPIPrompt: integrationPrefs.translationAPIPrompt || ''
        });
        setAvailableTranslationModels([]);
        setTranslationApiDialogOpen(true);
    }

    function setDiscordValue(key: any, value: any) {
        setDiscordPrefs((current: any) => ({ ...current, [key]: value }));
    }

    async function saveDiscordBoolPreference(key: any, value: any) {
        await commit(
            () => setDiscordBoolPreference(key, value),
            () => {
                const previous = discordPrefs[key];
                setDiscordValue(key, value);
                return () => setDiscordValue(key, previous);
            }
        );
    }

    async function validateYoutubeApiKey(apiKey: any) {
        if (!apiKey) {
            return;
        }
        const response = await externalApiRepository.fetchYoutubeVideoMetadata({
            videoId: 'dQw4w9WgXcQ',
            apiKey
        });
        const payload = parseWebJson(response);
        if (
            response.status !== 200 ||
            !Array.isArray(payload.items) ||
            payload.items.length === 0
        ) {
            throw new Error(t('dialog.youtube_api.msg_test_failed'));
        }
    }

    async function saveYoutubeApiKey() {
        const apiKey = youtubeApiKeyDraft.trim();
        setIntegrationStatus((current: any) => ({
            ...current,
            youtube: 'running'
        }));
        try {
            await validateYoutubeApiKey(apiKey);
            await setYoutubeApiKeyPreference(apiKey);
            setIntegrationPrefs((current: any) => ({
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
            setIntegrationStatus((current: any) => ({
                ...current,
                youtube: 'idle'
            }));
        }
    }

    async function saveTranslationApiConfig() {
        const nextType =
            translationDraft.translationAPIType === 'openai'
                ? 'openai'
                : 'google';
        const nextEndpoint =
            translationDraft.translationAPIEndpoint.trim() ||
            DEFAULT_TRANSLATION_ENDPOINT;
        const nextModel =
            translationDraft.translationAPIModel.trim() ||
            DEFAULT_TRANSLATION_MODEL;
        const nextKey = translationDraft.translationAPIKey.trim();
        const nextBioLanguage = languageCodes.includes(
            translationDraft.bioLanguage
        )
            ? translationDraft.bioLanguage
            : 'en';
        if (nextType === 'openai' && (!nextEndpoint || !nextModel)) {
            toast.warning(t('dialog.translation_api.msg_fill_endpoint_model'));
            return;
        }

        setIntegrationStatus((current: any) => ({
            ...current,
            translation: 'running'
        }));
        try {
            const savedConfig = await setTranslationApiConfigPreference({
                bioLanguage: nextBioLanguage,
                translationAPIType: nextType,
                translationAPIKey: nextKey,
                translationAPIEndpoint: nextEndpoint,
                translationAPIModel: nextModel,
                translationAPIPrompt: translationDraft.translationAPIPrompt
            });
            setIntegrationPrefs((current: any) => ({
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
            setIntegrationStatus((current: any) => ({
                ...current,
                translation: 'idle'
            }));
        }
    }

    async function fetchTranslationModels() {
        const endpoint =
            translationDraft.translationAPIEndpoint.trim() ||
            DEFAULT_TRANSLATION_ENDPOINT;
        const headers: any = {};
        if (translationDraft.translationAPIKey.trim()) {
            headers.Authorization = `Bearer ${translationDraft.translationAPIKey.trim()}`;
        }

        setIntegrationStatus((current: any) => ({
            ...current,
            models: 'running'
        }));
        try {
            const response =
                await externalApiRepository.executeTranslationRequest({
                    url: buildOpenAiModelsEndpoint(endpoint),
                    method: 'GET',
                    headers
                });
            if (response.status !== 200) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }
            const payload = parseWebJson(response);
            const models = Array.isArray(payload.data)
                ? payload.data
                      .map((model: any) => model?.id)
                      .filter(Boolean)
                      .sort()
                : Array.isArray(payload)
                  ? payload
                        .map((model: any) => model?.id || model?.name)
                        .filter(Boolean)
                        .sort()
                  : [];
            setAvailableTranslationModels(models);
            if (models.length && !translationDraft.translationAPIModel.trim()) {
                setTranslationDraftValue('translationAPIModel', models[0]);
            }
            toast.success(
                models.length
                    ? t('dialog.translation_api.msg_models_fetched', {
                          count: models.length
                      })
                    : t('dialog.translation_api.msg_no_models_found')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.settings.toast.failed_to_fetch_translation_models'
                      )
            );
        } finally {
            setIntegrationStatus((current: any) => ({
                ...current,
                models: 'idle'
            }));
        }
    }

    async function testTranslationApiConfig() {
        const provider =
            translationDraft.translationAPIType === 'openai'
                ? 'openai'
                : 'google';
        const apiKey = translationDraft.translationAPIKey.trim();
        setIntegrationStatus((current: any) => ({
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
            } else {
                const endpoint =
                    translationDraft.translationAPIEndpoint.trim() ||
                    DEFAULT_TRANSLATION_ENDPOINT;
                const model =
                    translationDraft.translationAPIModel.trim() ||
                    DEFAULT_TRANSLATION_MODEL;
                const headers: any = { 'Content-Type': 'application/json' };
                if (apiKey) {
                    headers.Authorization = `Bearer ${apiKey}`;
                }
                const response =
                    await externalApiRepository.executeTranslationRequest({
                        url: endpoint,
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            model,
                            messages: [
                                {
                                    role: 'system',
                                    content:
                                        translationDraft.translationAPIPrompt ||
                                        `Translate the user message into ${translationDraft.bioLanguage || 'en'}. Only return the translated text.`
                                },
                                { role: 'user', content: 'Hello world' }
                            ]
                        })
                    });
                if (response.status !== 200) {
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
            setIntegrationStatus((current: any) => ({
                ...current,
                translation: 'idle'
            }));
        }
    }

    return {
        availableTranslationModels,
        discordPrefs,
        fetchTranslationModels,
        integrationPrefs,
        integrationStatus,
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
