import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import type { DiscordPreferenceKey } from '@/state/preferencesStore';

import { refreshDiscordPresence } from '../discordPresenceService';
import {
    DEFAULT_TRANSLATION_ENDPOINT,
    DEFAULT_TRANSLATION_MODEL,
    DISCORD_BOOL_PREFERENCE_KEYS,
    VRCHAT_RICH_PRESENCE_CONFIG_KEY
} from './preferencesConstants';
import {
    normalizeBioLanguage,
    patchPreferences,
    publishPreferenceChanged
} from './preferencesCore';
import type { TranslationApiConfigPreferenceInput } from './preferencesTypes';

export async function setYoutubeApiEnabledPreference(value: boolean) {
    await configRepository.setBool('youtubeAPI', value);
    patchPreferences({ youtubeAPI: value });
    publishPreferenceChanged('youtubeAPI', value);
    return value;
}

export async function setYoutubeApiKeyPreference(value: string) {
    const youtubeAPIKey = String(value ?? '').trim();
    await configRepository.setString('youtubeAPIKey', youtubeAPIKey);
    publishPreferenceChanged('youtubeAPIKey', youtubeAPIKey);
    return youtubeAPIKey;
}

export async function setTranslationApiEnabledPreference(value: boolean) {
    await configRepository.setBool('translationAPI', value);
    patchPreferences({ translationAPI: value });
    publishPreferenceChanged('translationAPI', value);
    return value;
}

export async function setTranslationApiConfigPreference({
    bioLanguage,
    translationAPIType,
    translationAPIKey,
    translationAPIEndpoint,
    translationAPIModel,
    translationAPIPrompt
}: TranslationApiConfigPreferenceInput) {
    const nextBioLanguage = normalizeBioLanguage(bioLanguage);
    const nextType = translationAPIType === 'openai' ? 'openai' : 'google';
    const nextKey = String(translationAPIKey ?? '').trim();
    const nextEndpoint =
        String(translationAPIEndpoint || DEFAULT_TRANSLATION_ENDPOINT).trim() ||
        DEFAULT_TRANSLATION_ENDPOINT;
    const nextModel =
        String(translationAPIModel || DEFAULT_TRANSLATION_MODEL).trim() ||
        DEFAULT_TRANSLATION_MODEL;
    const nextPrompt = String(translationAPIPrompt ?? '');
    await configRepository.setMany([
        ['bioLanguage', nextBioLanguage],
        ['translationAPIType', nextType],
        ['translationAPIKey', nextKey],
        ['translationAPIEndpoint', nextEndpoint],
        ['translationAPIModel', nextModel],
        ['translationAPIPrompt', nextPrompt]
    ]);
    patchPreferences({
        bioLanguage: nextBioLanguage,
        translationAPIType: nextType,
        translationAPIEndpoint: nextEndpoint,
        translationAPIModel: nextModel,
        translationAPIPrompt: nextPrompt
    });
    publishPreferenceChanged('bioLanguage', nextBioLanguage);
    publishPreferenceChanged('translationAPIType', nextType);
    publishPreferenceChanged('translationAPIKey', nextKey);
    publishPreferenceChanged('translationAPIEndpoint', nextEndpoint);
    publishPreferenceChanged('translationAPIModel', nextModel);
    publishPreferenceChanged('translationAPIPrompt', nextPrompt);
    return {
        bioLanguage: nextBioLanguage,
        translationAPIType: nextType,
        translationAPIKey: nextKey,
        translationAPIEndpoint: nextEndpoint,
        translationAPIModel: nextModel,
        translationAPIPrompt: nextPrompt
    };
}

export async function setDiscordBoolPreference(
    key: DiscordPreferenceKey,
    value: boolean
) {
    if (!DISCORD_BOOL_PREFERENCE_KEYS.has(key)) {
        throw new Error(`Unsupported Discord preference: ${key}`);
    }
    const enabled = value;
    await configRepository.setBool(key, enabled);
    if (key === 'discordActive' && enabled) {
        await disableVrchatRichPresence().catch((error: unknown) => {
            console.warn('Failed to disable VRChat Rich Presence:', error);
        });
    }
    patchPreferences({ [key]: enabled });
    publishPreferenceChanged(key, enabled);
    refreshDiscordPresence({ force: true }).catch((error: unknown) => {
        console.warn(
            'Failed to refresh Discord Rich Presence after setting change:',
            error
        );
    });
    return enabled;
}

async function disableVrchatRichPresence() {
    const rawConfig = await commands.appReadConfigFile();
    const config = rawConfig ? JSON.parse(String(rawConfig)) : {};
    if (config?.[VRCHAT_RICH_PRESENCE_CONFIG_KEY] === true) {
        return;
    }

    await commands.appWriteConfigFile(
        JSON.stringify(
            {
                ...config,
                [VRCHAT_RICH_PRESENCE_CONFIG_KEY]: true
            },
            null,
            2
        )
    );
}
