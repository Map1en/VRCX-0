import { configRepository, webRepository } from '@/repositories/index.js';

const DEFAULT_TRANSLATION_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';

function parseWebJson(response) {
    if (response?.data && typeof response.data === 'object') {
        return response.data;
    }
    if (typeof response?.data === 'string' && response.data.trim()) {
        return JSON.parse(response.data);
    }
    return {};
}

export async function getTranslationConfig() {
    const [
        enabled,
        bioLanguage,
        type,
        key,
        endpoint,
        model,
        prompt
    ] = await Promise.all([
        configRepository.getBool('translationAPI', false),
        configRepository.getString('bioLanguage', 'en'),
        configRepository.getString('translationAPIType', 'google'),
        configRepository.getString('translationAPIKey', ''),
        configRepository.getString('translationAPIEndpoint', DEFAULT_TRANSLATION_ENDPOINT),
        configRepository.getString('translationAPIModel', DEFAULT_TRANSLATION_MODEL),
        configRepository.getString('translationAPIPrompt', '')
    ]);

    return {
        enabled: Boolean(enabled),
        bioLanguage: bioLanguage || 'en',
        type: type === 'openai' ? 'openai' : 'google',
        key: key || '',
        endpoint: endpoint || DEFAULT_TRANSLATION_ENDPOINT,
        model: model || DEFAULT_TRANSLATION_MODEL,
        prompt: prompt || ''
    };
}

export async function translateText(text, targetLanguage = '', overrides = {}) {
    const storedConfig = await getTranslationConfig();
    const config = {
        ...storedConfig,
        ...overrides
    };
    const target = targetLanguage || config.bioLanguage || 'en';

    if (!config.enabled) {
        throw new Error('Translation API disabled.');
    }

    if (config.type === 'google') {
        if (!config.key) {
            throw new Error('No Translation API key configured.');
        }
        const response = await webRepository.execute({
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

        return parseWebJson(response)?.data?.translations?.[0]?.translatedText || '';
    }

    const endpoint = config.endpoint || DEFAULT_TRANSLATION_ENDPOINT;
    const model = config.model || DEFAULT_TRANSLATION_MODEL;
    if (!endpoint || !model) {
        throw new Error('Translation endpoint/model missing.');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (config.key) {
        headers.Authorization = `Bearer ${config.key}`;
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
                    content: config.prompt || `You are a translation assistant. Translate the user message into ${target}. Only return the translated text.`
                },
                {
                    role: 'user',
                    content: text
                }
            ]
        })
    });

    if (response.status !== 200) {
        throw new Error(`Translation API error: ${response.status}`);
    }

    const translated = parseWebJson(response)?.choices?.[0]?.message?.content;
    return typeof translated === 'string' ? translated.trim() : '';
}
