import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    getTranslationConfig,
    translateTextDetailed
} from '@/services/translationService';

import type { TranslationErrorKind, TranslationViewMode } from './types';
import type { TranslationStatus } from './types';

interface TranslatedEntry {
    text: string;
    detectedSourceLang: string | null;
}

interface UseTextTranslationArgs {
    source: string;
    entityId: string;
}

export interface UseTextTranslationResult {
    status: TranslationStatus;
    mode: TranslationViewMode;
    visibleText: string;
    isTranslated: boolean;
    detectedLang: string | null;
    targetLang: string;
    canTranslate: boolean;
    isStale: boolean;
    errorKind: TranslationErrorKind | null;
    translate: () => Promise<void>;
    showOriginal: () => void;
    showTranslation: () => void;
    retranslate: () => Promise<void>;
}

const MIN_TRANSLATABLE_LENGTH = 2;
const NON_SYMBOL_PATTERN = /[\p{L}\p{N}]/u;

function computeCanTranslate(source: string): boolean {
    const trimmed = source.trim();
    if (trimmed.length < MIN_TRANSLATABLE_LENGTH) {
        return false;
    }
    return NON_SYMBOL_PATTERN.test(trimmed);
}

function classifyError(error: unknown): TranslationErrorKind {
    const message =
        error instanceof Error ? error.message : String(error ?? '');
    const lower = message.toLowerCase();
    if (
        lower.includes('disabled') ||
        lower.includes('unsupported') ||
        lower.includes('missing') ||
        lower.includes('key configured')
    ) {
        return 'unsupported';
    }
    if (
        lower.includes('network') ||
        lower.includes('fetch') ||
        lower.includes('failed to fetch')
    ) {
        return 'network';
    }
    return 'generic';
}

export function useTextTranslation({
    source,
    entityId
}: UseTextTranslationArgs): UseTextTranslationResult {
    const cacheRef = useRef<Map<string, TranslatedEntry>>(new Map());
    const entityIdRef = useRef(entityId);
    const [mode, setMode] = useState<TranslationViewMode>('original');
    const [status, setStatus] = useState<TranslationStatus>('idle');
    const [errorKind, setErrorKind] = useState<TranslationErrorKind | null>(
        null
    );
    const [targetLang, setTargetLang] = useState('');

    useEffect(() => {
        if (entityIdRef.current !== entityId) {
            cacheRef.current.clear();
            entityIdRef.current = entityId;
        }
        setMode('original');
        setStatus('idle');
        setErrorKind(null);
    }, [source, entityId]);

    useEffect(() => {
        let cancelled = false;
        getTranslationConfig()
            .then((config) => {
                if (!cancelled) {
                    setTargetLang(config.bioLanguage);
                }
            })
            .catch(() => {
                // Target language stays unresolved; the translate call re-reads config anyway.
            });
        return () => {
            cancelled = true;
        };
    }, [entityId]);

    const canTranslate = useMemo(() => computeCanTranslate(source), [source]);
    const cachedEntry = cacheRef.current.get(source);
    const isTranslated = mode === 'translation' && Boolean(cachedEntry);
    const visibleText = isTranslated ? cachedEntry!.text : source;
    const detectedLang = isTranslated ? cachedEntry!.detectedSourceLang : null;
    const isStale = !cachedEntry && cacheRef.current.size > 0;

    const runTranslation = useCallback(async () => {
        if (!canTranslate) {
            return;
        }
        setStatus('loading');
        setErrorKind(null);
        try {
            const config = await getTranslationConfig();
            setTargetLang(config.bioLanguage);
            const result = await translateTextDetailed(
                source,
                config.bioLanguage,
                config
            );
            if (!result.text) {
                throw new Error('No translation returned.');
            }
            cacheRef.current.set(source, result);
            setMode('translation');
            setStatus('translated');
        } catch (error) {
            setErrorKind(classifyError(error));
            setStatus('error');
        }
    }, [canTranslate, source]);

    const translate = useCallback(async () => {
        if (!canTranslate || status === 'loading') {
            return;
        }
        if (cacheRef.current.has(source)) {
            setMode('translation');
            setStatus('translated');
            setErrorKind(null);
            return;
        }
        await runTranslation();
    }, [canTranslate, runTranslation, source, status]);

    const retranslate = useCallback(async () => {
        if (!canTranslate || status === 'loading') {
            return;
        }
        cacheRef.current.delete(source);
        await runTranslation();
    }, [canTranslate, runTranslation, source, status]);

    const showOriginal = useCallback(() => {
        setMode('original');
    }, []);

    const showTranslation = useCallback(() => {
        if (cacheRef.current.has(source)) {
            setMode('translation');
            setStatus('translated');
            setErrorKind(null);
            return;
        }
        void runTranslation();
    }, [runTranslation, source]);

    return {
        status,
        mode,
        visibleText,
        isTranslated,
        detectedLang,
        targetLang,
        canTranslate,
        isStale,
        errorKind,
        translate,
        showOriginal,
        showTranslation,
        retranslate
    };
}
