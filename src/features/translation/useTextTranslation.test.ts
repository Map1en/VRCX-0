// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTranslationConfig: vi.fn(),
    translateTextDetailed: vi.fn()
}));

vi.mock('@/services/translationService', () => ({
    getTranslationConfig: mocks.getTranslationConfig,
    translateTextDetailed: mocks.translateTextDetailed
}));

import { useTextTranslation } from './useTextTranslation';

describe('useTextTranslation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTranslationConfig.mockResolvedValue({
            enabled: true,
            bioLanguage: 'ja',
            type: 'google',
            key: 'key',
            endpointId: '',
            endpoint: '',
            model: '',
            prompt: ''
        });
    });

    it('goes from idle to loading to translated on translate()', async () => {
        mocks.translateTextDetailed.mockResolvedValue({
            text: 'こんにちは',
            detectedSourceLang: 'en'
        });

        const { result } = renderHook(() =>
            useTextTranslation({ source: 'Hello', entityId: 'user-1' })
        );

        expect(result.current.status).toBe('idle');
        expect(result.current.mode).toBe('original');
        expect(result.current.canTranslate).toBe(true);

        await act(async () => {
            await result.current.translate();
        });

        expect(result.current.status).toBe('translated');
        expect(result.current.mode).toBe('translation');
        expect(result.current.isTranslated).toBe(true);
        expect(result.current.visibleText).toBe('こんにちは');
        expect(result.current.detectedLang).toBe('en');
        expect(mocks.translateTextDetailed).toHaveBeenCalledTimes(1);
    });

    it('reuses the cached translation and does not refetch on toggle', async () => {
        mocks.translateTextDetailed.mockResolvedValue({
            text: 'こんにちは',
            detectedSourceLang: 'en'
        });

        const { result } = renderHook(() =>
            useTextTranslation({ source: 'Hello', entityId: 'user-1' })
        );

        await act(async () => {
            await result.current.translate();
        });
        expect(mocks.translateTextDetailed).toHaveBeenCalledTimes(1);

        act(() => {
            result.current.showOriginal();
        });
        expect(result.current.mode).toBe('original');
        expect(result.current.visibleText).toBe('Hello');

        act(() => {
            result.current.showTranslation();
        });
        expect(result.current.mode).toBe('translation');
        expect(result.current.visibleText).toBe('こんにちは');
        expect(mocks.translateTextDetailed).toHaveBeenCalledTimes(1);

        await act(async () => {
            await result.current.translate();
        });
        expect(mocks.translateTextDetailed).toHaveBeenCalledTimes(1);
    });

    it('classifies network errors', async () => {
        mocks.translateTextDetailed.mockRejectedValue(
            new Error('Failed to fetch')
        );

        const { result } = renderHook(() =>
            useTextTranslation({ source: 'Hello', entityId: 'user-1' })
        );

        await act(async () => {
            await result.current.translate();
        });

        expect(result.current.status).toBe('error');
        expect(result.current.errorKind).toBe('network');
    });

    it('classifies generic errors', async () => {
        mocks.translateTextDetailed.mockRejectedValue(
            new Error('Translation API error: 500')
        );

        const { result } = renderHook(() =>
            useTextTranslation({ source: 'Hello', entityId: 'user-1' })
        );

        await act(async () => {
            await result.current.translate();
        });

        expect(result.current.status).toBe('error');
        expect(result.current.errorKind).toBe('generic');
    });

    it('classifies unsupported/disabled errors', async () => {
        mocks.translateTextDetailed.mockRejectedValue(
            new Error('Translation API disabled.')
        );

        const { result } = renderHook(() =>
            useTextTranslation({ source: 'Hello', entityId: 'user-1' })
        );

        await act(async () => {
            await result.current.translate();
        });

        expect(result.current.status).toBe('error');
        expect(result.current.errorKind).toBe('unsupported');
    });

    it('disables translation for empty or too-short source text', async () => {
        const { result: emptyResult } = renderHook(() =>
            useTextTranslation({ source: '', entityId: 'user-1' })
        );
        expect(emptyResult.current.canTranslate).toBe(false);

        const { result: shortResult } = renderHook(() =>
            useTextTranslation({ source: 'a', entityId: 'user-1' })
        );
        expect(shortResult.current.canTranslate).toBe(false);

        const { result: symbolsResult } = renderHook(() =>
            useTextTranslation({ source: '!!', entityId: 'user-1' })
        );
        expect(symbolsResult.current.canTranslate).toBe(false);

        const { result: validResult } = renderHook(() =>
            useTextTranslation({ source: 'Hi', entityId: 'user-1' })
        );
        expect(validResult.current.canTranslate).toBe(true);
    });

    it('resets translation state when the source or entity changes', async () => {
        mocks.translateTextDetailed.mockResolvedValue({
            text: 'こんにちは',
            detectedSourceLang: 'en'
        });

        const { result, rerender } = renderHook(
            (props: { source: string; entityId: string }) =>
                useTextTranslation(props),
            { initialProps: { source: 'Hello', entityId: 'user-1' } }
        );

        await act(async () => {
            await result.current.translate();
        });
        expect(result.current.isTranslated).toBe(true);

        rerender({ source: 'Bonjour', entityId: 'user-1' });
        expect(result.current.mode).toBe('original');
        expect(result.current.status).toBe('idle');
        expect(result.current.isTranslated).toBe(false);
        expect(result.current.visibleText).toBe('Bonjour');
    });
});
