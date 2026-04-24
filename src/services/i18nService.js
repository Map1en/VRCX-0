import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getAllLocalizedStrings } from '@/localization/index.js';

const allLocalizedStrings = getAllLocalizedStrings();
const i18nResources = Object.fromEntries(
    Object.entries(allLocalizedStrings).map(([locale, messages]) => [
        locale,
        { translation: messages || {} }
    ])
);

export const i18n = createInstance();
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
    returnNull: false
});

export default i18n;

function resolveMessage(messages, key) {
    return key.split('.').reduce((current, part) => current?.[part], messages);
}

function normalizeLocale(locale) {
    return typeof locale === 'string' && locale.trim() ? locale.trim() : 'en';
}

export async function setI18nLanguage(locale) {
    const normalizedLocale = normalizeLocale(locale);
    await i18nReady;
    await i18n.changeLanguage(normalizedLocale);
    return normalizedLocale;
}

export function getTimeUnitLabels(locale, defaultLabels) {
    const normalizedLocale =
        allLocalizedStrings[normalizeLocale(locale)] ? normalizeLocale(locale) : 'en';
    const localizedMessages = allLocalizedStrings[normalizedLocale] ?? {};
    const fallbackMessages = allLocalizedStrings.en ?? {};
    const labels = {};

    for (const unit of Object.keys(defaultLabels)) {
        const key = `common.time_units.${unit}`;
        const localized = resolveMessage(localizedMessages, key);
        const fallback = resolveMessage(fallbackMessages, key);
        labels[unit] =
            typeof localized === 'string'
                ? localized
                : typeof fallback === 'string'
                  ? fallback
                  : defaultLabels[unit];
    }

    return labels;
}

export async function translateForLocale(locale, key, params = {}) {
    const normalizedLocale = normalizeLocale(locale);
    await i18nReady;
    const translated = i18n.getFixedT(normalizedLocale)(key, params);

    if (translated !== key) {
        return translated;
    }

    return key;
}
