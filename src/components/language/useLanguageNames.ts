import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    createLanguageNamer,
    languageShortCode,
    nativeLanguageName
} from '@/shared/utils/userLanguage';

export function useLanguageNames() {
    const { t, i18n } = useTranslation();
    const locale = i18n.resolvedLanguage || i18n.language || 'en';
    return useMemo(() => {
        const languageName = createLanguageNamer(locale, (key) =>
            t(`common.spoken_language.${key}`, { defaultValue: '' })
        );
        const languageDetail = (key: unknown, nativeName?: string) => {
            const name = languageName(key);
            const native = nativeName?.trim() || nativeLanguageName(key);
            const code = languageShortCode(key);
            return native && native !== name
                ? `${name} · ${native} (${code})`
                : `${name} (${code})`;
        };
        return { languageName, languageDetail };
    }, [locale, t]);
}
