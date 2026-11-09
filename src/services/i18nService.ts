import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
    FALLBACK_LOCALE_CODE,
    fallbackLocaleMessages,
    loadLocaleMessages
} from '@/localization/index';
import { normalizeLanguageCode } from '@/localization/locales';
import type { TimeUnitLabels } from '@/shared/utils/dateTime';

const i18nResources = {
    [FALLBACK_LOCALE_CODE]: { translation: fallbackLocaleMessages }
};

const i18n = createInstance();
const i18nReady = i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['translation'],
    defaultNS: 'translation',
    resources: i18nResources,
    interpolation: {
        escapeValue: false,
        prefix: '{',
        suffix: '}'
    },
    react: {
        useSuspense: false
    },
    returnNull: false,
    returnEmptyString: true
});

export default i18n;

function normalizeLocale(locale: string): string {
    return normalizeLanguageCode(locale);
}

let latestLanguageRequest = 0;

export async function setI18nLanguage(locale: string): Promise<string> {
    const normalizedLocale = normalizeLocale(locale);
    const request = ++latestLanguageRequest;
    await i18nReady;
    if (!i18n.hasResourceBundle(normalizedLocale, 'translation')) {
        const messages = await loadLocaleMessages(normalizedLocale);
        i18n.addResourceBundle(normalizedLocale, 'translation', messages);
    }
    if (request !== latestLanguageRequest) {
        return normalizedLocale;
    }
    await i18n.changeLanguage(normalizedLocale);
    return normalizedLocale;
}

export function getTimeUnitLabels(): TimeUnitLabels {
    return {
        y: i18n.t('common.time_units.y'),
        d: i18n.t('common.time_units.d'),
        h: i18n.t('common.time_units.h'),
        m: i18n.t('common.time_units.m'),
        s: i18n.t('common.time_units.s')
    };
}
