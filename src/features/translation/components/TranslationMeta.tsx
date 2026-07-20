import { LanguagesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { getLanguageName } from '@/localization/index';

export interface TranslationMetaProps {
    detectedLang: string | null;
    targetLangLabel: string;
    className?: string;
}

export function TranslationMeta({
    detectedLang,
    targetLangLabel,
    className
}: TranslationMetaProps) {
    const { t } = useTranslation();
    const languageText = detectedLang
        ? t('translation.source_to_target', {
              source: getLanguageName(detectedLang),
              target: targetLangLabel
          })
        : targetLangLabel;

    return (
        <div
            className={cn(
                'text-muted-foreground flex flex-wrap items-center gap-1 text-xs',
                className
            )}
        >
            <LanguagesIcon data-icon="inline-start" className="size-3" />
            <span>{languageText}</span>
        </div>
    );
}
