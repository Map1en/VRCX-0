import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getAllLocalizedStrings } from '@/localization/index';
import { normalizeLanguageCode } from '@/localization/locales';

type LocalizedMessages = Record<string, unknown>;
type LocalizedStringMap = Record<string, LocalizedMessages>;
type TimeUnitLabels = Record<string, string>;
type TranslationParams = Record<string, unknown>;

const allLocalizedStrings = getAllLocalizedStrings() as LocalizedStringMap;
const i18nResources = Object.fromEntries(
    Object.entries(allLocalizedStrings).map(([locale, messages]: any) => [
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function resolveMessage(messages: unknown, key: string): unknown {
    return key
        .split('.')
        .reduce(
            (current: any, part: any) =>
                isRecord(current) ? current[part] : undefined,
            messages
        );
}

function normalizeLocale(locale: unknown): string {
    return normalizeLanguageCode(locale);
}

export async function setI18nLanguage(locale: unknown): Promise<string> {
    const normalizedLocale = normalizeLocale(locale);
    await i18nReady;
    await i18n.changeLanguage(normalizedLocale);
    return normalizedLocale;
}

export function getTimeUnitLabels(
    locale: unknown,
    defaultLabels: TimeUnitLabels
): TimeUnitLabels {
    const normalizedLocale = allLocalizedStrings[normalizeLocale(locale)]
        ? normalizeLocale(locale)
        : 'en';
    const localizedMessages = allLocalizedStrings[normalizedLocale] ?? {};
    const fallbackMessages = allLocalizedStrings.en ?? {};
    const labels: TimeUnitLabels = {};

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

export async function translateForLocale(
    locale: unknown,
    key: string,
    params: TranslationParams = {}
): Promise<string> {
    const normalizedLocale = normalizeLocale(locale);
    await i18nReady;
    const translated = i18n.getFixedT(normalizedLocale)(key, params);

    if (typeof translated === 'string' && translated !== key) {
        return translated;
    }

    return key;
}
