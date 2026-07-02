import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getBool: vi.fn(),
    getString: vi.fn(),
    appLlmEndpointList: vi.fn(),
    appLlmTranslate: vi.fn(),
    executeTranslationRequest: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appLlmEndpointList: mocks.appLlmEndpointList,
        appLlmTranslate: mocks.appLlmTranslate
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: mocks.getBool,
        getString: mocks.getString
    }
}));

vi.mock('@/repositories/externalApiRepository', () => ({
    default: {
        executeTranslationRequest: mocks.executeTranslationRequest
    }
}));

import {
    normalizeDeepLTargetLanguage,
    translateText
} from './translationService';

describe('translationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getBool.mockResolvedValue(true);
        mocks.appLlmEndpointList.mockResolvedValue([]);
        mocks.getString.mockImplementation((key: string, fallback = '') => {
            const values: Record<string, string> = {
                bioLanguage: 'ja',
                translationAPIType: 'deepl',
                translationAPIKey: 'deepl-key',
                translationAPIEndpoint:
                    'https://api.openai.com/v1/chat/completions',
                translationAPIModel: 'gpt-4o-mini',
                translationAPIPrompt: ''
            };
            return Promise.resolve(values[key] ?? String(fallback ?? ''));
        });
    });

    it('normalizes app language codes for DeepL target_lang', () => {
        expect(normalizeDeepLTargetLanguage('en')).toBe('EN-US');
        expect(normalizeDeepLTargetLanguage('pt')).toBe('PT-BR');
        expect(normalizeDeepLTargetLanguage('zh-CN')).toBe('ZH-HANS');
        expect(normalizeDeepLTargetLanguage('zh-TW')).toBe('ZH-HANT');
        expect(normalizeDeepLTargetLanguage('ja')).toBe('JA');
    });

    it('translates through the DeepL Free API', async () => {
        mocks.executeTranslationRequest.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                translations: [{ text: 'こんにちは' }]
            })
        });

        await expect(translateText('Hello', 'ja')).resolves.toBe('こんにちは');

        expect(mocks.executeTranslationRequest).toHaveBeenCalledWith({
            url: 'https://api-free.deepl.com/v2/translate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'DeepL-Auth-Key deepl-key'
            },
            body: JSON.stringify({
                text: ['Hello'],
                target_lang: 'JA'
            })
        });
    });

    it('translates OpenAI-compatible requests through the backend LLM endpoint', async () => {
        mocks.getString.mockImplementation((key: string, fallback = '') => {
            const values: Record<string, string> = {
                bioLanguage: 'ja',
                translationAPIType: 'openai',
                translationEndpointId: 'ep_123',
                translationAPIKey: 'legacy-front-key',
                translationAPIEndpoint:
                    'https://api.openai.com/v1/chat/completions',
                translationAPIModel: 'gpt-4o-mini',
                translationAPIPrompt: 'Translate only.'
            };
            return Promise.resolve(values[key] ?? String(fallback ?? ''));
        });
        mocks.appLlmTranslate.mockResolvedValue('こんにちは');

        await expect(translateText('Hello', 'ja')).resolves.toBe('こんにちは');

        expect(mocks.appLlmTranslate).toHaveBeenCalledWith({
            endpointId: 'ep_123',
            model: 'gpt-4o-mini',
            prompt: 'Translate only.',
            targetLang: 'ja',
            text: 'Hello'
        });
        expect(mocks.executeTranslationRequest).not.toHaveBeenCalled();
    });

    it('triggers legacy OpenAI-compatible endpoint migration before translating', async () => {
        let endpointIdReads = 0;
        mocks.getString.mockImplementation((key: string, fallback = '') => {
            if (key === 'translationEndpointId') {
                endpointIdReads += 1;
                return Promise.resolve(
                    endpointIdReads === 1 ? '' : 'ep_migrated'
                );
            }
            const values: Record<string, string> = {
                bioLanguage: 'ja',
                translationAPIType: 'openai',
                translationAPIKey: 'legacy-front-key',
                translationAPIEndpoint:
                    'https://api.openai.com/v1/chat/completions',
                translationAPIModel: 'gpt-4o-mini',
                translationAPIPrompt: ''
            };
            return Promise.resolve(values[key] ?? String(fallback ?? ''));
        });
        mocks.appLlmTranslate.mockResolvedValue('こんにちは');

        await expect(translateText('Hello', 'ja')).resolves.toBe('こんにちは');

        expect(mocks.appLlmEndpointList).toHaveBeenCalledTimes(1);
        expect(mocks.appLlmTranslate).toHaveBeenCalledWith({
            endpointId: 'ep_migrated',
            model: 'gpt-4o-mini',
            prompt: null,
            targetLang: 'ja',
            text: 'Hello'
        });
        expect(mocks.executeTranslationRequest).not.toHaveBeenCalled();
    });
});
