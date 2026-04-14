import { getLocalizedStrings } from '@/localization/index.js';
import { useShellStore } from '@/state/shellStore.js';
import { initReactI18next } from 'react-i18next';
import { createInstance } from 'i18next';

const localeCache = new Map();
export const appI18n = createInstance();
const appI18nReady = appI18n
    .use(initReactI18next)
    .init({
        lng: 'en',
        fallbackLng: 'en',
        ns: ['translation'],
        defaultNS: 'translation',
        resources: {
            en: { translation: {} }
        },
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

function resolveMessage(messages, key) {
    return key.split('.').reduce((current, part) => current?.[part], messages);
}

async function loadMessages(locale) {
    const normalizedLocale =
        typeof locale === 'string' && locale.trim() ? locale.trim() : 'en';

    if (!localeCache.has(normalizedLocale)) {
        localeCache.set(
            normalizedLocale,
            getLocalizedStrings(normalizedLocale).catch(() => ({}))
        );
    }

    return localeCache.get(normalizedLocale);
}

export function buildTimeUnitLabels(messages, fallbackMessages, defaultLabels) {
    const labels = {};

    for (const unit of Object.keys(defaultLabels)) {
        const key = `common.time_units.${unit}`;
        const localized = resolveMessage(messages, key);
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

export async function ensureI18nLocale(locale) {
    const normalizedLocale =
        typeof locale === 'string' && locale.trim() ? locale.trim() : 'en';
    const [fallbackMessages, localizedMessages] = await Promise.all([
        loadMessages('en'),
        normalizedLocale === 'en' ? Promise.resolve(null) : loadMessages(normalizedLocale)
    ]);

    await appI18nReady;
    appI18n.addResourceBundle('en', 'translation', fallbackMessages ?? {}, true, true);
    if (normalizedLocale !== 'en') {
        appI18n.addResourceBundle(normalizedLocale, 'translation', localizedMessages ?? {}, true, true);
    }

    return {
        locale: normalizedLocale,
        fallbackMessages: fallbackMessages ?? {},
        localizedMessages: normalizedLocale === 'en' ? fallbackMessages ?? {} : localizedMessages ?? {}
    };
}

export async function changeI18nLocale(locale) {
    const result = await ensureI18nLocale(locale);
    await appI18n.changeLanguage(result.locale);
    return result;
}

export async function translateForLocale(locale, key, params = {}) {
    const normalizedLocale =
        typeof locale === 'string' && locale.trim() ? locale.trim() : 'en';
    await ensureI18nLocale(normalizedLocale);
    const translated = appI18n.getFixedT(normalizedLocale)(key, params);

    if (translated !== key) {
        return translated;
    }

    return key;
}

export async function translateCurrentLocale(key, params = {}) {
    return translateForLocale(useShellStore.getState().locale || 'en', key, params);
}
