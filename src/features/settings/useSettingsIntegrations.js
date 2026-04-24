import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { languageCodes } from '@/localization/index.js';
import {
    configRepository,
    webRepository
} from '@/repositories/index.js';
import {
    setDiscordBoolPreference,
    setTranslationApiConfigPreference,
    setYoutubeApiKeyPreference
} from '@/services/preferencesService.js';

import {
    buildOpenAiModelsEndpoint,
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL,
    parseWebJson
} from './settingsValues.js';

export function useSettingsIntegrations({ commit, t }) {
    const [integrationPrefs, setIntegrationPrefs] = useState({
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
    const [discordPrefs, setDiscordPrefs] = useState({
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
        useState([]);
    const [integrationStatus, setIntegrationStatus] = useState({
        youtube: 'idle',
        translation: 'idle',
        models: 'idle'
    });
    const [youtubeApiDialogOpen, setYoutubeApiDialogOpen] = useState(false);
    const [youtubeApiKeyDraft, setYoutubeApiKeyDraft] = useState('');
    const [translationApiDialogOpen, setTranslationApiDialogOpen] =
        useState(false);
    const [translationDraft, setTranslationDraft] = useState({
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

    function setIntegrationValue(key, value) {
        setIntegrationPrefs((current) => ({ ...current, [key]: value }));
    }

    function setTranslationDraftValue(key, value) {
        setTranslationDraft((current) => ({ ...current, [key]: value }));
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

    function setDiscordValue(key, value) {
        setDiscordPrefs((current) => ({ ...current, [key]: value }));
    }

    async function saveDiscordBoolPreference(key, value) {
        await commit(
            () => setDiscordBoolPreference(key, value),
            () => {
                const previous = discordPrefs[key];
                setDiscordValue(key, value);
                return () => setDiscordValue(key, previous);
            }
        );
    }

    async function validateYoutubeApiKey(apiKey) {
        if (!apiKey) {
            return;
        }
        const response = await webRepository.execute({
            url: `https://www.googleapis.com/youtube/v3/videos?id=dQw4w9WgXcQ&part=snippet,contentDetails&key=${encodeURIComponent(apiKey)}`,
            method: 'GET'
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
        setIntegrationStatus((current) => ({ ...current, youtube: 'running' }));
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

        setIntegrationStatus((current) => ({
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
                    : t('view.settings.generated_toast.failed_to_save_translation_settings')
            );
        } finally {
            setIntegrationStatus((current) => ({
                ...current,
                translation: 'idle'
            }));
        }
    }

    async function fetchTranslationModels() {
        const endpoint =
            translationDraft.translationAPIEndpoint.trim() ||
            DEFAULT_TRANSLATION_ENDPOINT;
        const headers = {};
        if (translationDraft.translationAPIKey.trim()) {
            headers.Authorization = `Bearer ${translationDraft.translationAPIKey.trim()}`;
        }

        setIntegrationStatus((current) => ({ ...current, models: 'running' }));
        try {
            const response = await webRepository.execute({
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
                      .map((model) => model?.id)
                      .filter(Boolean)
                      .sort()
                : Array.isArray(payload)
                  ? payload
                        .map((model) => model?.id || model?.name)
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
                    : t('view.settings.generated_toast.failed_to_fetch_translation_models')
            );
        } finally {
            setIntegrationStatus((current) => ({ ...current, models: 'idle' }));
        }
    }

    async function testTranslationApiConfig() {
        const provider =
            translationDraft.translationAPIType === 'openai'
                ? 'openai'
                : 'google';
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
                const response = await webRepository.execute({
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
                const headers = { 'Content-Type': 'application/json' };
                if (apiKey) {
                    headers.Authorization = `Bearer ${apiKey}`;
                }
                const response = await webRepository.execute({
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
            setIntegrationStatus((current) => ({
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
