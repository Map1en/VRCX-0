import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { getLanguageName } from '@/localization/index';

import { translationErrorI18nKey } from '../types';
import { useTextTranslation } from '../useTextTranslation';
import { TranslationAction } from './TranslationAction';
import { TranslationMeta } from './TranslationMeta';

interface TranslatableTextRender {
    action: ReactNode;
    meta: ReactNode;
    error: ReactNode;
    text: string;
    isTranslated: boolean;
}

interface TranslatableTextProps {
    source: string;
    entityId: string;
    density: 'icon' | 'button';
    children: (render: TranslatableTextRender) => ReactNode;
}

export function TranslatableText({
    source,
    entityId,
    density,
    children
}: TranslatableTextProps) {
    const { t } = useTranslation();
    const {
        status,
        visibleText,
        isTranslated,
        detectedLang,
        targetLang,
        canTranslate,
        errorKind,
        translate,
        showOriginal
    } = useTextTranslation({ source, entityId });
    const targetLangLabel = targetLang ? getLanguageName(targetLang) : '';

    return children({
        text: visibleText,
        isTranslated,
        action: (
            <TranslationAction
                density={density}
                status={status}
                isTranslated={isTranslated}
                canTranslate={canTranslate}
                onTranslate={translate}
                onShowOriginal={showOriginal}
            />
        ),
        meta: isTranslated ? (
            <TranslationMeta
                className="mb-1.5"
                detectedLang={detectedLang}
                targetLangLabel={targetLangLabel}
            />
        ) : null,
        error:
            status === 'error' && errorKind ? (
                <p className="text-destructive mt-1 text-xs">
                    {t(translationErrorI18nKey(errorKind))}
                </p>
            ) : null
    });
}
