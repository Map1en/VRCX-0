import { LanguagesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IntentTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import type { TranslationStatus } from './types';

export interface TranslationActionProps {
    density: 'icon' | 'button';
    status: TranslationStatus;
    isTranslated: boolean;
    canTranslate: boolean;
    onTranslate: () => void;
    onShowOriginal: () => void;
}

export function TranslationAction({
    density,
    status,
    isTranslated,
    canTranslate,
    onTranslate,
    onShowOriginal
}: TranslationActionProps) {
    const { t } = useTranslation();

    if (!canTranslate) {
        return null;
    }

    const isLoading = status === 'loading';
    const label = isTranslated
        ? t('translation.show_original')
        : t('translation.translate');
    const onClick = () => (isTranslated ? onShowOriginal() : onTranslate());
    const glyph = isLoading ? (
        <Spinner data-icon="inline-start" />
    ) : (
        <LanguagesIcon data-icon="inline-start" />
    );

    if (density === 'icon') {
        return (
            <IntentTooltip content={label}>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={isLoading}
                    aria-busy={isLoading}
                    aria-label={label}
                    onClick={onClick}
                >
                    {glyph}
                </Button>
            </IntentTooltip>
        );
    }

    return (
        <Button
            type="button"
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            disabled={isLoading}
            aria-busy={isLoading}
            aria-label={label}
            onClick={onClick}
        >
            {glyph}
            <span>{label}</span>
        </Button>
    );
}
