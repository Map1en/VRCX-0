export type TranslationStatus = 'idle' | 'loading' | 'translated' | 'error';

export type TranslationErrorKind = 'generic' | 'network' | 'unsupported';

export type TranslationViewMode = 'original' | 'translation';

export function translationErrorI18nKey(kind: TranslationErrorKind): string {
    if (kind === 'network') {
        return 'translation.error_network';
    }
    if (kind === 'unsupported') {
        return 'translation.error_unsupported';
    }
    return 'translation.error_generic';
}
