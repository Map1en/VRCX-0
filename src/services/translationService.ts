import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import externalApiRepository from '@/repositories/externalApiRepository';
import {
    normalizeTranslationApiType,
    type TranslationApiType
} from '@/state/preferencesStore';

const DEFAULT_TRANSLATION_ENDPOINT =
    'https://api.openai.com/v1/chat/completions';
const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';
const DEEPL_FREE_TRANSLATION_ENDPOINT =
    'https://api-free.deepl.com/v2/translate';

type TranslationType = TranslationApiType;
type TranslationConfig = {
    enabled: boolean;
    bioLanguage: string;
    type: TranslationType;
    key: string;
    endpointId: string;
    endpoint: string;
    model: string;
    prompt: string;
};
type TranslationOverrides = Partial<TranslationConfig>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function parseWebJson(response: unknown): Record<string, unknown> {
    const responseRecord = isRecord(response) ? response : {};
    const data = responseRecord.data;
    if (data && typeof data === 'object') {
        return data as Record<string, unknown>;
    }
    if (typeof data === 'string' && data.trim()) {
        const parsed = JSON.parse(data);
        return isRecord(parsed) ? parsed : {};
    }
    return {};
}

export function normalizeDeepLTargetLanguage(language: unknown): string {
    const value = String(language || 'en')
        .trim()
        .replace(/_/g, '-')
        .toLowerCase();
    if (value === 'en' || value.startsWith('en-')) {
        return 'EN-US';
    }
    if (value === 'pt' || value.startsWith('pt-')) {
        return 'PT-BR';
    }
    if (value === 'zh-tw' || value === 'zh-hant') {
        return 'ZH-HANT';
    }
    if (value === 'zh-cn' || value === 'zh-hans' || value === 'zh') {
        return 'ZH-HANS';
    }
    return value.toUpperCase();
}

export async function getTranslationConfig(): Promise<TranslationConfig> {
    const [
        enabled,
        bioLanguage,
        type,
        key,
        endpointId,
        endpoint,
        model,
        prompt
    ] = await Promise.all([
        configRepository.getBool('translationAPI', false),
        configRepository.getString('bioLanguage', 'en'),
        configRepository.getString('translationAPIType', 'google'),
        configRepository.getString('translationAPIKey', ''),
        configRepository.getString('translationEndpointId', ''),
        configRepository.getString(
            'translationAPIEndpoint',
            DEFAULT_TRANSLATION_ENDPOINT
        ),
        configRepository.getString(
            'translationAPIModel',
            DEFAULT_TRANSLATION_MODEL
        ),
        configRepository.getString('translationAPIPrompt', '')
    ]);

    return {
        enabled: Boolean(enabled),
        bioLanguage: String(bioLanguage || 'en'),
        type: normalizeTranslationApiType(type),
        key: String(key || ''),
        endpointId: String(endpointId || ''),
        endpoint: String(endpoint || DEFAULT_TRANSLATION_ENDPOINT),
        model: String(model || DEFAULT_TRANSLATION_MODEL),
        prompt: String(prompt || '')
    };
}

async function resolveOpenAiTranslationEndpointId(
    endpointId: string
): Promise<string> {
    const trimmed = endpointId.trim();
    if (trimmed) {
        return trimmed;
    }
    await commands.appLlmEndpointList();
    return String(
        (await configRepository.getString('translationEndpointId', '')) || ''
    ).trim();
}

export async function translateText(
    text: string,
    targetLanguage: unknown = '',
    overrides: TranslationOverrides = {}
): Promise<string> {
    const storedConfig = await getTranslationConfig();
    const config: TranslationConfig = {
        ...storedConfig,
        ...overrides
    };
    const target = String(targetLanguage || config.bioLanguage || 'en');

    if (!config.enabled) {
        throw new Error('Translation API disabled.');
    }

    if (config.type === 'google') {
        if (!config.key) {
            throw new Error('No Translation API key configured.');
        }
        const response = await externalApiRepository.executeTranslationRequest({
            url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(config.key)}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                q: text,
                target,
                format: 'text'
            })
        });

        if (response.status !== 200) {
            throw new Error(`Translation API error: ${response.status}`);
        }

        const json = parseWebJson(response);
        const data = isRecord(json.data) ? json.data : {};
        const translations = Array.isArray(data.translations)
            ? data.translations
            : [];
        const firstTranslation = isRecord(translations[0])
            ? translations[0]
            : {};
        return typeof firstTranslation.translatedText === 'string'
            ? firstTranslation.translatedText
            : '';
    }

    if (config.type === 'deepl') {
        if (!config.key) {
            throw new Error('No Translation API key configured.');
        }
        const response = await externalApiRepository.executeTranslationRequest({
            url: DEEPL_FREE_TRANSLATION_ENDPOINT,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `DeepL-Auth-Key ${config.key}`
            },
            body: JSON.stringify({
                text: [text],
                target_lang: normalizeDeepLTargetLanguage(target)
            })
        });

        if (response.status !== 200) {
            throw new Error(`Translation API error: ${response.status}`);
        }

        const json = parseWebJson(response);
        const translations = Array.isArray(json.translations)
            ? json.translations
            : [];
        const firstTranslation = isRecord(translations[0])
            ? translations[0]
            : {};
        return typeof firstTranslation.text === 'string'
            ? firstTranslation.text.trim()
            : '';
    }

    const endpointId = await resolveOpenAiTranslationEndpointId(
        config.endpointId
    );
    const model = config.model || DEFAULT_TRANSLATION_MODEL;
    if (!endpointId || !model) {
        throw new Error('Translation endpoint/model missing.');
    }

    return commands.appLlmTranslate({
        endpointId,
        model,
        prompt: config.prompt || null,
        targetLang: target,
        text
    });
}
